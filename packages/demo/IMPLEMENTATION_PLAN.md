# Gmail Agent Demo - Implementation Plan

## Overview

Build a demo application that allows users to sign in with Google, then interact with their Gmail through a conversational AI agent. The agent will have tools to query unread emails and send emails on behalf of the user.

## Architecture

### High-Level Flow

```
User → Demo App (React) → Demo Server (Express) → Together Agent → Gmail Tools → Google Gmail API
                ↓                                       ↓
         Google OAuth Flow                    Access Token via secrets
```

### Components

**1. Demo App Frontend (React)**
- Google Sign-in button
- Chat interface to interact with agent
- Display streamed messages from agent

**2. Demo App Backend (Express)**
- OAuth routes for Google authentication
- Session management to store access token
- Agent creation and management
- SSE endpoint to stream agent messages to client

**3. Agent Tools (deployed separately)**
- `readEmails.ts` - Query unread Gmail messages
- `sendEmail.ts` - Send emails via Gmail API

**4. Deployed Agent**
- Pre-deployed using `together-agent deploy`
- Tools bundled and available in agent environment
- Agent ID stored in demo app config

## Technical Details

### Google OAuth 2.0 Setup

**Prerequisites:**
1. Create Google Cloud Project
2. Enable Gmail API
3. Create OAuth 2.0 credentials (Client ID & Secret)
4. Configure OAuth consent screen
5. Add redirect URI: `http://localhost:3000/auth/google/callback`

**Required Scopes:**
- `https://www.googleapis.com/auth/gmail.readonly` - Read emails
- `https://www.googleapis.com/auth/gmail.send` - Send emails
- `https://www.googleapis.com/auth/userinfo.email` - User email
- `https://www.googleapis.com/auth/userinfo.profile` - User profile

**Token Management:**
- **Access Token**: Short-lived (~1 hour), stored in server session
- **Refresh Token**: NOT NEEDED for demo (sessions are short)
- Token passed to agent via `secrets` parameter on each prompt

### Agent Architecture

**How tokens flow to tools:**
```javascript
// 1. User authenticates, server stores token in session
req.session.googleAccessToken = 'ya29.a0AfH6SMB...'

// 2. When prompting agent, pass token as secret
agent.prompt('Show my unread emails', {
  secrets: {
    GOOGLE_ACCESS_TOKEN: req.session.googleAccessToken
  }
})

// 3. Tools receive token via context
execute: async (params, context) => {
  const token = context.secrets.GOOGLE_ACCESS_TOKEN;

  // 4. Instantiate googleapis SDK with token
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: token });

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  // 5. Make Gmail API calls
  await gmail.users.messages.list({ userId: 'me' });
}
```

**Key Points:**
- Each tool instantiates googleapis SDK independently
- Token is passed fresh on each agent prompt
- No shared state between tool executions
- No database needed for demo

### Gmail API Capabilities

**Read Emails:**
```javascript
// List messages with query
gmail.users.messages.list({
  userId: 'me',
  q: 'is:unread',  // Gmail search syntax
  maxResults: 10
})

// Get message details
gmail.users.messages.get({
  userId: 'me',
  id: messageId,
  format: 'full'  // or 'metadata', 'minimal'
})
```

**Send Emails:**
```javascript
// Compose email in RFC 2822 format, encode to base64
const email = [
  'To: recipient@example.com',
  'Subject: Hello',
  '',
  'Email body here'
].join('\n');

const base64Email = Buffer.from(email).toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '');

gmail.users.messages.send({
  userId: 'me',
  requestBody: {
    raw: base64Email
  }
})
```

### Server-Sent Events (SSE)

**Agent message types:**
- `text` - AI-generated text response
- `tool_discovery_completed` - Tools found for query
- `custom_tool_call_started` - Tool execution started
- `custom_tool_call_completed` - Tool execution finished
- `approval_request` - Tool needs user approval
- `error` - Error occurred
- `done` - Stream finished

**SSE Flow:**
```javascript
// Server: Stream messages to client
res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('Cache-Control', 'no-cache');

for await (const message of agentStream) {
  res.write(`data: ${JSON.stringify(message)}\n\n`);
}

// Client: Listen for messages
const eventSource = new EventSource('/api/agent/prompt');
eventSource.onmessage = (event) => {
  const message = JSON.parse(event.data);
  // Update UI based on message type
}
```

### Approval Flow (for sendEmail)

**How approval works:**

1. **Tool requests approval:**
```javascript
// In sendEmail.ts
await context.requestApproval({
  action: 'send_email',
  to,
  subject,
  body,
  warning: 'This will send a real email to the recipient'
});
```

2. **Agent sends approval_request message via SSE:**
```javascript
{
  type: 'approval_request',
  approvalId: 'approval-1234567890-abc123',
  payload: {
    action: 'send_email',
    to: 'recipient@example.com',
    subject: 'Hello',
    body: 'Email content',
    warning: 'This will send a real email to the recipient'
  }
}
```

3. **Client shows approval UI:**
```javascript
// In Chat.tsx
if (message.type === 'approval_request') {
  setApprovalRequest({
    approvalId: message.approvalId,
    payload: message.payload
  });
  setShowApprovalDialog(true);
  setChatDisabled(true); // Block input during approval
}
```

4. **User clicks Approve or Reject:**
```javascript
// Send response to server
await fetch('/api/agent/approval', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    approvalId: 'approval-1234567890-abc123',
    approved: true  // or false
  })
});

// Server forwards to agent
await agent.approve(approvalId);  // or agent.reject(approvalId)
```

5. **Agent resumes execution:**
- If approved: Tool continues and sends email
- If rejected: Tool throws error, agent handles gracefully
- SSE stream continues with result

6. **Client receives completion:**
```javascript
{
  type: 'custom_tool_call_completed',
  toolName: 'sendEmail',
  callId: 'sendEmail-1234567890-xyz',
  result: {
    success: true,
    messageId: 'msg-...'
  }
}
```

**Important notes:**
- The SSE connection stays open during approval (don't close it!)
- Agent waits for approval response before continuing
- Default timeout is 30 seconds (configurable)
- If timeout expires, tool throws error and agent handles it

**Visual Flow:**
```
User: "Send email to john@example.com"
  ↓
Demo Server receives prompt
  ↓
Server calls agent.prompt() with Google access token
  ↓
Agent discovers sendEmail tool
  ↓
Agent executes sendEmail tool
  ↓
Tool calls context.requestApproval()
  ↓
Agent sends approval_request via SSE → Client shows dialog
  ↓
[SSE connection stays open, agent paused, waiting...]
  ↓
User clicks "Approve" → Client POSTs to /api/agent/approval
  ↓
Server forwards to agent.approve(approvalId)
  ↓
Agent resumes, tool continues execution
  ↓
Tool sends email via Gmail API
  ↓
Tool returns success → Agent sends completion message via SSE
  ↓
Client displays "Email sent successfully!"
```

## Implementation Plan

### Phase 1: Google OAuth Authentication

**1.1 Backend - OAuth Setup**
- [ ] Install dependencies: `googleapis`, `express-session`, `passport`, `passport-google-oauth20`
- [ ] Create `.env` file with Google credentials
  ```
  GOOGLE_CLIENT_ID=...
  GOOGLE_CLIENT_SECRET=...
  SESSION_SECRET=...
  TOGETHER_API_KEY=...
  AGENT_TEMPLATE_ID=... (to be filled after deployment)
  ```
- [ ] Configure express-session middleware
- [ ] Set up Passport with Google OAuth strategy
- [ ] Create auth routes:
  - `GET /auth/google` - Initiate OAuth flow
  - `GET /auth/google/callback` - Handle Google redirect
  - `GET /auth/logout` - Clear session
  - `GET /auth/user` - Get current user info

**1.2 Frontend - Sign In UI**
- [ ] Create `Login.tsx` component with "Sign in with Google" button
- [ ] Add auth state management (useState/useContext)
- [ ] Fetch user info on mount
- [ ] Show user profile when authenticated
- [ ] Add sign out button

### Phase 2: Chat Interface

**2.1 Frontend - Chat UI**
- [ ] Create `Chat.tsx` component
- [ ] Message input field with send button
- [ ] Message list with auto-scroll
- [ ] Display different message types:
  - User messages
  - AI text responses
  - Tool execution status
  - Approval requests (if needed)
- [ ] Loading states during agent processing
- [ ] Error handling UI

**2.2 Backend - Agent Management**
- [ ] Create agent instance on server startup (or lazy load)
- [ ] Store agent reference in memory (single agent for all users)
- [ ] Create SSE endpoint: `POST /api/agent/prompt`
  - Verify user is authenticated
  - Get access token from session
  - Accept `{ prompt }` in request body
  - Call agent.prompt() with token in secrets
  - Stream messages back via SSE
- [ ] Create approval proxy endpoint: `POST /api/agent/approval`
  - Verify user is authenticated
  - Accept `{ approvalId, approved }` in request body
  - Forward to agent's approval endpoint
  - Agent will resume execution and continue SSE stream
  - Return success response

**2.3 Frontend - SSE Integration**
- [ ] Create `useAgentStream()` hook
- [ ] Establish EventSource connection
- [ ] Parse and handle message types
- [ ] Update chat UI in real-time
- [ ] Close connection on unmount

**2.4 Approval UI Flow**
- [ ] Create `ApprovalDialog.tsx` component
  - Display approval payload (to, subject, body for emails)
  - Show warning message
  - "Approve" and "Reject" buttons
  - Disable chat input while approval is pending
- [ ] Handle `approval_request` message in chat:
  - Extract `approvalId` and `payload` from message
  - Show ApprovalDialog with payload details
  - Block further messages until approval resolved
- [ ] Implement approval actions:
  - On "Approve": POST to `/api/agent/approval` with `{ approvalId, approved: true }`
  - On "Reject": POST to `/api/agent/approval` with `{ approvalId, approved: false }`
  - Close dialog and re-enable chat input
  - Continue listening to SSE stream (agent will resume)
- [ ] Handle approval timeout:
  - Show timeout error if agent doesn't receive response
  - Allow user to retry or dismiss

### Phase 3: Gmail Tools

**3.1 Setup Tools Directory**
- [ ] Create `packages/demo/tools/` directory
- [ ] Add `package.json` with dependencies:
  ```json
  {
    "dependencies": {
      "googleapis": "latest",
      "zod": "latest"
    }
  }
  ```
- [ ] Add `tsconfig.json` for TypeScript compilation

**3.2 Implement readEmails Tool**
- [ ] Create `packages/demo/tools/readEmails.ts`
- [ ] Define Zod schema for parameters:
  - `query` (optional) - Gmail search query
  - `maxResults` (optional) - Number of emails to return
- [ ] Implement execute function:
  - Get token from context.secrets
  - Instantiate googleapis oauth2Client
  - Set credentials with access token
  - Call `gmail.users.messages.list()`
  - For each message, call `gmail.users.messages.get()`
  - Parse and return email data (subject, from, date, snippet)

**3.3 Implement sendEmail Tool**
- [ ] Create `packages/demo/tools/sendEmail.ts`
- [ ] Use tool factory pattern: `export default (context) => ({...})`
- [ ] Define Zod schema for parameters:
  - `to` - Recipient email
  - `subject` - Email subject
  - `body` - Email body text
- [ ] Implement execute function:
  - Add `context.requestApproval()` for safety
  - Get token from context.secrets
  - Instantiate googleapis oauth2Client
  - Compose email in RFC 2822 format
  - Encode to base64 (URL-safe)
  - Call `gmail.users.messages.send()`
  - Return success response with messageId

**3.4 Add Comprehensive Tool Descriptions**
- [ ] Add extensive keywords to tool descriptions for better discovery
- [ ] Include synonyms: email, mail, gmail, message, inbox, etc.
- [ ] Include action verbs: read, list, query, send, compose, draft, etc.

### Phase 4: Agent Deployment

**4.1 Build and Deploy Agent**
- [ ] Navigate to `packages/demo/tools/`
- [ ] Build tools: `tsc` (compile TypeScript)
- [ ] Deploy using together-agent CLI:
  ```bash
  cd packages/demo
  together-agent deploy ./tools
  ```
- [ ] Copy returned agent template ID
- [ ] Add template ID to `.env` as `AGENT_TEMPLATE_ID`

**4.2 Integrate Agent in Demo Server**
- [ ] Import `TogetherAgentSDK` from together-agent package
- [ ] Create agent instance on server startup:
  ```javascript
  const sdk = new TogetherAgentSDK({ apiKey: process.env.TOGETHER_API_KEY });
  const agent = await sdk.createAgent(process.env.AGENT_TEMPLATE_ID);
  ```
- [ ] Use agent in SSE endpoint

### Phase 5: Integration & Testing

**5.1 End-to-End Testing**
- [ ] Test OAuth flow (sign in/sign out)
- [ ] Test chat interface with simple prompts
- [ ] Test reading emails: "Show me my unread emails"
- [ ] Test sending emails with approval flow:
  - [ ] Prompt: "Send an email to test@example.com saying hello"
  - [ ] Verify approval dialog appears with correct details (to, subject, body)
  - [ ] Test "Approve" - email should send successfully
  - [ ] Test "Reject" - email should not send, agent handles gracefully
  - [ ] Verify chat input is disabled during approval
  - [ ] Verify chat re-enables after approval/rejection
  - [ ] Test approval timeout (wait 30+ seconds without responding)
- [ ] Verify token expiration handling (after 1 hour)

**5.2 Error Handling**
- [ ] Handle OAuth errors (user denies permission)
- [ ] Handle expired tokens (show re-auth message)
- [ ] Handle Gmail API errors (quota exceeded, invalid format)
- [ ] Handle agent errors (tool execution failures)
- [ ] Handle network errors (SSE connection lost)

**5.3 UI Polish**
- [ ] Add loading spinners
- [ ] Add error notifications
- [ ] Add success notifications
- [ ] Improve message formatting (parse email data nicely)
- [ ] Add responsive design
- [ ] Add message timestamps

### Phase 6: Documentation & Demo

**6.1 Setup Instructions**
- [ ] Create README with setup steps
- [ ] Document Google Cloud Console setup
- [ ] Document environment variable configuration
- [ ] Add screenshots of OAuth setup

**6.2 Demo Scenarios**
- [ ] Create demo script for presentations
- [ ] Example prompts:
  - **Read emails**: "What are my latest unread emails?"
  - **Search emails**: "Show me emails from john@example.com"
  - **Send with approval**: "Send an email to jane@example.com with subject 'Meeting' saying 'Let's meet tomorrow at 2pm'"
    - Demo will pause and show approval dialog
    - User reviews: To, Subject, Body
    - User clicks "Approve"
    - Email sends and agent confirms success
- [ ] Video recording of full flow including approval

## File Structure

```
packages/demo/
├── server/
│   ├── index.ts                    # Main server
│   ├── auth/
│   │   └── google.ts               # OAuth setup & routes
│   └── agent/
│       └── stream.ts               # Agent SSE endpoint
├── src/
│   ├── App.tsx                     # Main app component
│   ├── components/
│   │   ├── Login.tsx               # Google sign-in
│   │   ├── Chat.tsx                # Chat interface
│   │   ├── Message.tsx             # Individual message
│   │   └── ApprovalDialog.tsx      # Approval UI for sendEmail
│   └── hooks/
│       └── useAgentStream.ts       # SSE hook
├── tools/
│   ├── package.json
│   ├── tsconfig.json
│   ├── readEmails.ts               # Gmail read tool
│   └── sendEmail.ts                # Gmail send tool
├── .env                            # Environment variables
└── IMPLEMENTATION_PLAN.md          # This file
```

## Environment Variables

```bash
# Google OAuth
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret
SESSION_SECRET=random_string_for_session_encryption

# Together Agent
TOGETHER_API_KEY=your_together_api_key
AGENT_TEMPLATE_ID=pt_xxx  # Set after deploying tools

# Server
NODE_ENV=development
PORT=3000
```

## Security Considerations

1. **Never expose tokens to frontend** - All Gmail API calls through agent tools on server
2. **Use HTTPS in production** - OAuth requires secure connections
3. **Validate OAuth state parameter** - Prevent CSRF attacks (Passport handles this)
4. **Request approval for sensitive actions** - Use `context.requestApproval()` for sending emails
5. **Set proper CORS** - Restrict API access to your domain
6. **Encrypt session cookies** - Use strong SESSION_SECRET
7. **Don't commit secrets** - Add `.env` to `.gitignore`

## Known Limitations (Demo)

1. **Access tokens expire after 1 hour** - Users need to re-authenticate
2. **No refresh token** - Keeps demo simple, no database needed
3. **Single agent instance** - All users share same agent (okay for demo)
4. **In-memory sessions** - Lost on server restart (use Redis for production)
5. **No user isolation** - Agent doesn't track individual users (add user context for production)

## Next Steps After Demo

If converting to production:
1. Add refresh token support with encrypted database storage
2. Implement per-user agent instances or user context
3. Use persistent session store (Redis, MongoDB)
4. Add rate limiting
5. Add logging and monitoring
6. Deploy to production environment with HTTPS
7. Add comprehensive error tracking
8. Implement proper user management

## Resources

- [Google Gmail API Documentation](https://developers.google.com/gmail/api)
- [Google OAuth 2.0 Guide](https://developers.google.com/identity/protocols/oauth2)
- [googleapis npm package](https://www.npmjs.com/package/googleapis)
- [Together Agent SDK](../../README.md)
- [Server-Sent Events MDN](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
