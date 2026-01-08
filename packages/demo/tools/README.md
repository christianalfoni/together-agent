# Gmail Agent Tools

This directory contains the custom tools for the Gmail Agent demo.

## Tools

### `readEmails.ts`
Reads and queries emails from Gmail inbox.

**Features:**
- List unread emails
- Search for specific emails using Gmail search syntax
- Get email details (subject, sender, date, content)
- Filter emails by various criteria

**Parameters:**
- `query` (optional): Gmail search query (default: "is:unread")
- `maxResults` (optional): Max emails to return (1-50, default: 10)

**Example queries:**
- `is:unread` - Unread emails
- `from:john@example.com` - Emails from John
- `subject:meeting` - Emails with "meeting" in subject
- `after:2024/01/01` - Emails after Jan 1, 2024

### `sendEmail.ts`
Sends emails via Gmail with user approval.

**Features:**
- Compose and send new emails
- Requires user approval before sending
- Supports CC and BCC
- Plain text emails (RFC 2822 format)

**Parameters:**
- `to` (required): Recipient email address
- `subject` (required): Email subject
- `body` (required): Email body (plain text)
- `cc` (optional): CC email address
- `bcc` (optional): BCC email address

**Approval Flow:**
1. Tool is called with email details
2. Execution pauses and sends approval request to user
3. User sees email details in approval dialog
4. User approves or rejects
5. If approved, email is sent; if rejected, tool throws error

## Building

To compile the TypeScript tools:

```bash
cd packages/demo/tools
npm install
npx tsc
```

This will generate JavaScript files in the `dist/` directory.

## Deployment

To deploy these tools as an agent:

```bash
cd packages/demo
together-agent deploy ./tools
```

This will:
1. Bundle the tools
2. Deploy to CodeSandbox
3. Return an agent template ID
4. Store the template ID in your `.env` as `AGENT_TEMPLATE_ID`

## Authentication

Both tools require a Google access token passed via the `secrets` parameter:

```javascript
agent.prompt('Show my unread emails', {
  secrets: {
    GOOGLE_ACCESS_TOKEN: 'ya29.a0...'
  }
})
```

The demo server automatically passes the user's Google access token from their session.

## Required Google OAuth Scopes

These tools require the following OAuth scopes:

- `https://www.googleapis.com/auth/gmail.readonly` - For reading emails
- `https://www.googleapis.com/auth/gmail.send` - For sending emails

These scopes are configured in the demo server's Google OAuth setup.

## Error Handling

Both tools handle common errors:

- **401 Unauthorized**: Access token expired - user needs to sign in again
- **403 Forbidden**: Insufficient permissions - user needs to grant required scopes
- **400 Bad Request**: Invalid email format or parameters
- **Network errors**: Connection issues with Gmail API

All errors include user-friendly messages that explain what went wrong and how to fix it.
