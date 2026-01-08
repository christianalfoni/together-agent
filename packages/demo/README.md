# Gmail Agent Demo

An AI-powered Gmail assistant that allows users to sign in with Google and interact with their Gmail through a conversational agent. The agent can read emails and send emails on behalf of the user with approval.

## Features

- **Google OAuth Authentication**: Secure sign-in with Google
- **Gmail Integration**: Read and send emails via Gmail API
- **AI Agent**: Conversational interface powered by Together Agent SDK
- **Approval Flow**: User approval required before sending emails
- **Real-time Streaming**: Server-Sent Events for agent responses

## Prerequisites

Before running this demo, you need to:

1. **Create a Google Cloud Project** and enable Gmail API
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select an existing one
   - Enable the Gmail API
   - Create OAuth 2.0 credentials (Client ID & Secret)
   - Add authorized redirect URI: `http://localhost:3000/auth/google/callback`

2. **Get a Together API Key**
   - Sign up at [Together AI](https://api.together.xyz/)
   - Generate an API key

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment variables**:
   ```bash
   cp .env.example .env
   ```

   Edit `.env` and fill in your credentials:
   ```
   GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your_client_secret
   SESSION_SECRET=random_string_for_session_encryption
   TOGETHER_API_KEY=your_together_api_key
   # AGENT_TEMPLATE_ID will be set after deploying tools (Phase 4)
   ```

3. **Start the development server**:
   ```bash
   npm run dev
   ```

4. **Open your browser**:
   ```
   http://localhost:3000
   ```

## Project Structure

```
demo/
├── server/                     # Express API server
│   ├── index.ts               # Main server
│   └── auth/
│       └── google.ts          # Google OAuth setup & routes
├── src/                       # Frontend source
│   ├── App.tsx               # Main app component
│   ├── components/
│   │   └── Login.tsx         # Login UI component
│   └── hooks/
│       └── useAuth.ts        # Auth state management
├── tools/                     # Agent tools (Phase 3)
│   ├── readEmails.ts         # Read Gmail messages
│   └── sendEmail.ts          # Send Gmail messages
├── .env.example              # Environment variables template
└── IMPLEMENTATION_PLAN.md    # Detailed implementation guide
```

## Implementation Status

✅ **Phase 1: Google OAuth Authentication** - COMPLETED
- Backend OAuth setup with Passport.js
- Frontend login UI with Google sign-in
- Session management

🚧 **Phase 2: Chat Interface** - TODO
- Chat UI components
- Agent SSE integration
- Approval dialog

🚧 **Phase 3: Gmail Tools** - TODO
- readEmails tool
- sendEmail tool with approval

🚧 **Phase 4: Agent Deployment** - TODO
- Deploy tools using together-agent CLI
- Integrate agent in server

See [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) for detailed implementation steps.

## API Endpoints

### Authentication
- `GET /auth/google` - Initiate Google OAuth flow
- `GET /auth/google/callback` - OAuth callback handler
- `GET /auth/logout` - Log out user
- `GET /auth/user` - Get current user info (authenticated)

### Agent (Coming in Phase 2)
- `POST /api/agent/prompt` - Send prompt to agent (SSE stream)
- `POST /api/agent/approval` - Approve/reject agent actions

## Security Notes

- Never commit your `.env` file (it's in `.gitignore`)
- Access tokens are stored in server sessions, never exposed to frontend
- Sensitive actions (sending emails) require explicit user approval
- Use HTTPS in production environments

## Next Steps

Continue with Phase 2 to implement the chat interface and agent integration. See the [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) for details.
