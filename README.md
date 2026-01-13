# Together Agent

Build AI agents with custom tools powered by Together AI.

## Table of Contents

- [Quick Start](#quick-start)
- [Defining Your Agent](#defining-your-agent)
- [How It Works](#how-it-works)
  - [Architecture](#architecture)
  - [The Three Native Tools](#the-three-native-tools)
  - [Execution Flow](#execution-flow)
  - [Message Streaming](#message-streaming)
- [Security](#security)
  - [Code Execution Security](#code-execution-security)
  - [Secrets Security](#secrets-security)
  - [Sandbox Isolation](#sandbox-isolation)
  - [Best Practices](#best-practices)
- [Secrets Management](#secrets-management)
  - [Tool Context](#tool-context)
  - [Accessing Secrets](#accessing-secrets)
  - [Passing Secrets](#passing-secrets)
- [Approval System](#approval-system)
  - [Requesting Approval](#requesting-approval)
  - [How It Works](#how-it-works-1)
- [API Reference](#api-reference)
  - [CLI Commands](#cli-commands)
  - [Node.js Client](#nodejs-client)
  - [Tool Definition API](#tool-definition-api)
- [Best Practices](#best-practices-1)
  - [Tool Descriptions](#tool-descriptions)
  - [Error Handling](#error-handling)
  - [Parallel Tool Execution](#parallel-tool-execution)
- [Environment Variables](#environment-variables)
- [Troubleshooting](#troubleshooting)
- [Examples](#examples)
  - [Weather Tool](#weather-tool)
  - [Email Tool with Approval](#email-tool-with-approval)
  - [Database Query Tool](#database-query-tool)
  - [File Operations Tool](#file-operations-tool)
- [License](#license)

## Quick Start

**1. Install**
```bash
npm install -g together-agent
```

**2. Create your agent**
```bash
export TOGETHER_API_KEY="your-key"
together-agent init ./my-agent
```

**3. Test locally**
```bash
together-agent run ./my-agent
> What's the weather in Tokyo?
```

**4. Deploy**
```bash
together-agent deploy ./my-agent
# Returns: pt_abc123 (your template ID)
```

**5. Use in your app**
```typescript
import { TogetherAgentSDK } from 'together-agent';

const sdk = new TogetherAgentSDK({ apiKey: process.env.TOGETHER_API_KEY });
const agent = await sdk.createAgent('pt_abc123');

// Stream messages from the agent
for await (const message of agent.prompt('What is the weather in Tokyo?')) {
  if (message.type === 'text') {
    console.log(message.content);
  }
}
```

## Defining Your Agent

Your agent consists of capabilities that are TypeScript modules. Use the `capability()` function from `together-agent` to define capabilities with type safety:

```typescript
// my-agent/getWeather.ts
import { z } from 'zod';
import { capability } from 'together-agent';

export default capability({
  discoveryTerms: ['weather', 'forecast', 'temperature', 'climate', 'conditions', 'degrees', 'fahrenheit', 'celsius', 'rain', 'snow', 'wind', 'humidity'],
  inputSchema: z.object({
    location: z.string().describe('City name'),
    units: z.enum(['fahrenheit', 'celsius']).default('fahrenheit').describe('Temperature units'),
  }),
  execute: async (input, context) => {
    // Your weather API call would go here
    return {
      location: input.location,
      temperature: input.units === 'celsius' ? 8 : 46,
      units: input.units,
      condition: 'partly cloudy',
      humidity: 72,
      windSpeed: 15,
    };
  },
});
```

**Accessing secrets and requesting approval:**

```typescript
// my-agent/sendEmail.ts
import { capability } from 'together-agent';
import { z } from 'zod';

export default capability({
  discoveryTerms: ['email', 'send', 'message', 'mail', 'recipient', 'address', 'notification', 'letter', 'correspondence'],
  inputSchema: z.object({
    to: z.string().describe('Email address'),
    subject: z.string().describe('Subject line'),
    body: z.string().describe('Email content'),
  }),
  execute: async (input, context) => {
    // Access secrets from context
    const apiKey = context.secrets.SENDGRID_API_KEY;

    // Request approval for sensitive actions
    await context.requestApproval({
      action: 'send_email',
      to: input.to,
      subject: input.subject,
    });

    // Send email using apiKey
    return { success: true };
  },
});
```

**Multiple tools in one file (named exports):**

```typescript
// my-agent/emails.ts
import { capability } from 'together-agent';
import { z } from 'zod';

export const sendEmail = capability({
  discoveryTerms: ['email', 'send', 'message', 'mail', 'recipient'],
  inputSchema: z.object({
    to: z.string().describe('Email address'),
    subject: z.string(),
    body: z.string(),
  }),
  execute: async (input, context) => {
    const apiKey = context.secrets.SENDGRID_API_KEY;
    // Send email
    return { success: true };
  },
});

export const readEmails = capability({
  discoveryTerms: ['email', 'read', 'inbox', 'messages', 'unread'],
  inputSchema: z.object({
    folder: z.enum(['inbox', 'sent']).default('inbox'),
    limit: z.number().default(10),
  }),
  execute: async (input, context) => {
    const apiKey = context.secrets.EMAIL_API_KEY;
    // Read emails
    return { emails: [] };
  },
});
```

Pass secrets via CLI using a `.env` file:
```bash
# Create a .env file in your current directory:
# SENDGRID_API_KEY=xyz

together-agent run ./my-agent
```

Or in your application:
```typescript
await agent.prompt('Send an email...', {
  secrets: { SENDGRID_API_KEY: 'xyz' }
});
```

---

## How It Works

### Architecture

Together Agent combines three key components:

1. **AI Model** - Interprets user requests and decides which tools to use
2. **Native Tools** - Built-in tools that discover and execute your custom tools
3. **Custom Tools** - Your domain-specific tools (weather, email, etc.)

### The Three Native Tools

Every agent has three built-in tools that work together to execute tasks:

#### 1. `discover_tools`
Searches your custom tools by analyzing descriptions and schemas.

```
User: "What's the weather in Paris?"
Agent: Uses discover_tools("weather temperature forecast")
Result: ["getWeather"]
```

#### 2. `execute_code`
Executes JavaScript code for both tool calling and general computation.

**Use cases:**
1. **Calling custom tools** - Execute code with access to discovered tools via the `tools` object
2. **General computation** - Perform calculations, data manipulation, string processing, etc.

```javascript
// For calling custom tools:
const weather = await tools.getWeather({ location: "Paris" });
console.log(weather);

// For calculations and data manipulation:
const result = Math.sqrt(144) * 2;
console.log(result);
```

The code is validated for safety (no `require()`, `import`, `eval()`, etc.) and executed in a sandboxed environment.

### Execution Flow

```
1. User sends prompt → "What's the weather in Paris?"

2. Agent discovers tools
   discover_tools("weather forecast temperature")
   → matches: ["getWeather"]

3. Agent generates code
   execute_code(`
     const weather = await tools.getWeather({ location: "Paris" });
     console.log(weather);
   `)
   → executes getWeather with validated input
   → returns: { temperature: 62, condition: "cloudy" }

4. Agent responds
   → "The weather in Paris is 62°F and cloudy."
```

### Message Streaming

Agents stream real-time progress messages via Server-Sent Events (SSE):

```typescript
// Message types:
{
  type: "tool_discovery_completed",
  matchedTools: ["getWeather"]
}

{
  type: "tool_execution_started",
  code: "const weather = await tools.getWeather(...);"
}

{
  type: "custom_tool_call_started",
  toolName: "getWeather",
  args: { location: "Paris" }
}

{
  type: "custom_tool_call_completed",
  toolName: "getWeather",
  result: { temperature: 62, condition: "cloudy" }
}

{
  type: "text",
  content: "The weather in Paris is 62°F and cloudy."
}

{
  type: "done"
}
```

---

## Security

Together Agent implements multiple layers of security to protect against code injection, secrets exposure, and unauthorized access.

### Code Execution Security

When the AI generates code to call your tools, that code is **never directly executed**. Instead:

1. **AST Parsing** - Generated code is parsed into an Abstract Syntax Tree (AST) before execution
2. **Static Analysis** - The AST is analyzed to detect and reject dangerous patterns:
   - No `require()` or `import` statements
   - No `eval()`, `Function()`, or code generation
   - No access to `process`, `global`, or other Node.js internals
   - No filesystem or network access
3. **Controlled Execution** - Only validated code runs in a restricted JavaScript environment

This prevents the AI from generating malicious code that attempts to access system resources or escape the sandbox.

### Secrets Security

Secrets (API keys, credentials, etc.) are handled with strict isolation:

**How secrets are protected:**

1. **Context-based isolation** - Secrets are passed via the execution context:
   ```typescript
   import { capability } from 'together-agent';

   export default capability({
     discoveryTerms: ['example', 'demo'],
     inputSchema: z.object({ /* ... */ }),
     execute: async (input, context) => {
       const apiKey = context.secrets.API_KEY;  // ✅ Tools can access secrets
       // ...
     }
   })
   ```

2. **Proxy layer** - When the AI generates code like `tools.getWeather({ location: "Paris" })`, it's calling a **proxy**, not your actual tool:
   ```
   AI-generated code → Proxy → Validates input → Calls actual tool with secrets
   ```

3. **No direct access** - The AI-generated code never sees your tool implementations or secrets:
   ```javascript
   // AI generates this:
   const result = await tools.getWeather({ location: "Paris" });

   // It CANNOT do this (secrets not in scope):
   const apiKey = context.secrets.API_KEY;  // ❌ ReferenceError

   // It CANNOT do this (no access to tool source):
   console.log(tools.getWeather.toString());  // ❌ Returns proxy, not real function
   ```

**Secrets are:**
- Never stored in code or version control
- Only accessible during tool execution
- Isolated from AI-generated code via closures
- Never included in conversation history or logs

### Sandbox Isolation

Each agent runs in an **isolated CodeSandbox environment per end user**:

- Separate filesystem and process space
- Network-isolated from other users
- Temporary execution environment
- No persistent state between sessions

The security measures above (AST validation, proxy layer, secret isolation) are **additional protections** on top of this sandbox isolation, providing defense-in-depth against potential exploits.

### Best Practices

To maximize security:

1. **Never hardcode secrets** - Always use `context.secrets`
2. **Request approval for sensitive actions** - Use `context.requestApproval()` for operations like sending emails, making payments, or deleting data
3. **Validate tool inputs** - Even though inputs are validated against your Zod schema, add additional business logic validation
4. **Sanitize tool outputs** - If outputs will be displayed to users, sanitize them to prevent XSS or injection attacks

---

## Secrets Management

Tools often need API keys, credentials, or configuration. Together Agent provides a secure way to pass these at runtime.

### Tool Context

Every tool receives a `context` object with:

```typescript
interface ToolExecutionContext {
  secrets: Record<string, string>;        // Environment variables
  requestApproval: (payload, timeout) => Promise<void>;  // User approval
  workspacePath: string;                  // Absolute path to workspace directory
}
```

The `workspacePath` provides a dedicated directory where your tools can read and write files. This workspace is:
- Created automatically when the agent starts in the current working directory
- Persistent across tool executions within the same session
- Isolated per agent instance (each deployed agent has its own workspace)
- Available at `./workspace` relative to where the agent runs

### Accessing Secrets

Tools automatically receive context with secrets and approval methods:

```typescript
// my-agent/searchWeb.ts
import { capability } from 'together-agent';
import { z } from 'zod';

export default capability({
  discoveryTerms: ['web', 'search', 'internet', 'browser', 'google', 'bing', 'brave', 'online', 'webpage', 'website', 'url', 'link', 'crawl', 'index'],
  inputSchema: z.object({
    query: z.string(),
  }),
  execute: async (input, context) => {
    const apiKey = context.secrets.BRAVE_API_KEY;

    if (!apiKey) {
      throw new Error('BRAVE_API_KEY is required');
    }

    // Use the API key
    const response = await fetch(`https://api.brave.com?q=${input.query}&key=${apiKey}`);
    return response.json();
  },
})
```

### Passing Secrets

**CLI (local testing):**

Create a `.env` file in your current directory:
```bash
# .env
BRAVE_API_KEY=abc123
SENDGRID_KEY=xyz789
```

Then run your agent:
```bash
together-agent run ./my-agent
```

The CLI will automatically load all variables from the `.env` file and pass them as secrets to your tools.

**In your application:**
```typescript
await agent.prompt('Search for AI news', {
  secrets: {
    BRAVE_API_KEY: process.env.BRAVE_API_KEY,
    SENDGRID_KEY: process.env.SENDGRID_KEY,
  }
});
```

Secrets are:
- Never stored in code or version control
- Passed at runtime per request
- Only available during tool execution
- Not included in conversation history

### Security Best Practices

**🔴 Critical: Never Log Secrets**

Console output from tools is visible to the AI model. If you log secrets, the AI can see them in execution results.

❌ **DON'T DO THIS:**
```typescript
execute: async (input, context) => {
  const apiKey = context.secrets.API_KEY;
  console.log("Using API key:", apiKey);  // ❌ DANGEROUS! Exposes secret to AI
  console.log("Full context:", context);   // ❌ DANGEROUS! Exposes all secrets

  const response = await callAPI(apiKey);
  return response;
}
```

✅ **DO THIS INSTEAD:**
```typescript
execute: async (input, context) => {
  const apiKey = context.secrets.API_KEY;
  console.log("Calling API...");           // ✅ SAFE - no secret exposed

  const response = await callAPI(apiKey);
  console.log("API call completed");       // ✅ SAFE - generic message
  return response;
}
```

**🔴 Critical: Sanitize Error Messages**

Error messages are returned to the AI. Exceptions that include secrets or sensitive information will leak them.

❌ **DON'T DO THIS:**
```typescript
try {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
} catch (error) {
  // ❌ DANGEROUS! May include the API key in error message
  throw new Error(`API call failed with key ${apiKey}: ${error.message}`);

  // ❌ DANGEROUS! Stack traces may include file paths and secrets
  throw error;
}
```

✅ **DO THIS INSTEAD:**
```typescript
try {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });

  if (!response.ok) {
    // ✅ SAFE - no secrets, just status info
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }
} catch (error) {
  // ✅ SAFE - sanitized error message
  throw new Error(`API call failed: ${error.message}`);
}
```

**Best practices for error handling:**
- Never include secrets in error messages
- Remove stack traces before throwing
- Use generic error messages when possible
- Don't expose internal file paths or system information

**🟢 Optional: Validate Secrets Early**

Check for required secrets immediately to provide clear error messages:

```typescript
execute: async (input, context) => {
  // Check for required secrets first
  const apiKey = context.secrets.API_KEY;
  if (!apiKey) {
    throw new Error('API_KEY environment variable is required');
  }

  // Optionally validate format
  if (!apiKey.startsWith('sk_')) {
    throw new Error('API_KEY must start with sk_');
  }

  // Continue with execution
  return await callAPI(apiKey, input);
}
```

---

## Approval System

Some tools perform sensitive actions (send emails, delete data, charge cards). The approval system lets you request user confirmation before execution.

### Requesting Approval

```typescript
import { capability } from 'together-agent';
import { z } from 'zod';

export default capability({
  discoveryTerms: ['email', 'send', 'mail', 'message'],
  inputSchema: z.object({
    to: z.string(),
    subject: z.string(),
    body: z.string(),
  }),
  execute: async (input, context) => {
    // Request approval before sending
    await context.requestApproval({
      action: 'send_email',
      to: input.to,
      subject: input.subject,
      body: input.body,
      warning: 'This will send a real email',
    });

    // If we get here, user approved
    // Send the email...
    return { success: true };
  },
})
```

### How It Works

1. **Tool calls `requestApproval(payload, timeout)`**
   - `payload`: Any data (object, string, etc.) shown to the user
   - `timeout`: Milliseconds to wait (default: 30000)

2. **Agent sends approval request message**
   ```typescript
   {
     type: "approval_request",
     approvalId: "approval-123",
     payload: {
       action: "send_email",
       to: "user@example.com",
       warning: "This will send a real email"
     }
   }
   ```

3. **Client prompts user** (CLI shows interactive prompt)
   ```
   🔐 APPROVAL REQUIRED
   {
     "action": "send_email",
     "to": "user@example.com",
     "warning": "This will send a real email"
   }
   Approve? (yes/no):
   ```

4. **Client responds via `/prompt/approval` endpoint**
   ```typescript
   POST /prompt/approval
   {
     "approvalId": "approval-123",
     "approved": true
   }
   ```

5. **Tool execution continues or throws**
   - If approved: execution continues
   - If rejected: throws error with message "User declined to proceed"
   - If timeout: throws error "User did not confirm within N seconds"

### When to Use Approval

**🟡 Important: Always use approval for sensitive actions**

Without approval, the AI can perform destructive or costly actions without user confirmation.

**Examples of actions that need approval:**
- Sending emails
- Making purchases or payments
- Deleting data
- Modifying important records
- Posting to social media
- Making expensive API calls

**Example implementation:**
```typescript
export default capability({
  discoveryTerms: ['email', 'send', 'mail', 'message'],
  inputSchema: z.object({
    to: z.string(),
    subject: z.string(),
    body: z.string(),
  }),
  execute: async (input, context) => {
    // Request approval BEFORE performing the action
    await context.requestApproval({
      action: 'send_email',
      to: input.to,
      subject: input.subject,
      body: input.body.substring(0, 200), // Show preview
      warning: 'This will send a real email to the recipient'
    });

    // Only proceeds if user approves
    const apiKey = context.secrets.SENDGRID_API_KEY;
    await sendEmail(input.to, input.subject, input.body, apiKey);

    return { success: true };
  }
})
```

---

## API Reference

### CLI Commands

### `init <path>`

Initialize a new agent with example tools.

```bash
together-agent init ./my-agent
```

Creates:
- `package.json` with dependencies (zod, typescript)
- `tsconfig.json` for TypeScript compilation
- `getWeather.ts` example tool
- Runs `npm install` automatically

### `run <agent-path> [options]`

Run your agent locally for testing.

```bash
together-agent run ./my-agent [options]
```

**Options:**
- `-p, --port <port>` - Port to run server on (default: 3000)

**Environment Variables:**

The `run` command automatically loads environment variables from a `.env` file in your current directory and passes them as secrets to your tools.

**Examples:**
```bash
# Basic usage
together-agent run ./my-agent

# Custom port
together-agent run ./my-agent -p 8080

# With secrets - create a .env file first:
# .env
# BRAVE_API_KEY=abc123
# SENDGRID_KEY=xyz789
together-agent run ./my-agent
```

**Interactive session:**
```
Agent server running on http://localhost:3000

Enter your prompt (or 'exit' to quit): What's the weather?

─────────────────────────────────────────────────
🔍 TOOL DISCOVERY
Matched tools: getWeather
─────────────────────────────────────────────────

─────────────────────────────────────────────────
▶️  GETWEATHER - STARTED
{ "location": "current" }
─────────────────────────────────────────────────

─────────────────────────────────────────────────
✅ GETWEATHER - COMPLETED
Result: { "temperature": 72, "condition": "sunny" }
─────────────────────────────────────────────────

─────────────────────────────────────────────────
💬 RESPONSE
The weather is currently 72°F and sunny.
─────────────────────────────────────────────────

Enter your prompt (or 'exit' to quit):
```

### `deploy <agent-path>`

Deploy your agent to CodeSandbox for production use.

```bash
together-agent deploy ./my-agent
```

**Process:**
1. Compiles your agent's TypeScript tools to JavaScript
2. Creates deployment package with agent runtime
3. Deploys to CodeSandbox
4. Returns template ID and endpoint URL

**Output:**
```
✓ Deployment complete!

Agent template id: pt_26zjNr5yoewkZY9NefgnmH

POST https://6mtpjl-3000.csb.app/prompt
{
  "prompt": "How are you?",
  "apiKey": "",
  "secrets": {}
}
```

Save the template ID to use with the Node.js client.

### Node.js Client

#### `TogetherAgentSDK`

Main client class for interacting with deployed agents.

```typescript
import { TogetherAgentSDK } from 'together-agent';

const sdk = new TogetherAgentSDK({
  apiKey: 'your-together-api-key'  // Optional if TOGETHER_API_KEY is set
});
```

### `createAgent(templateId)`

Creates an agent instance from a deployed template.

```typescript
const agent = await sdk.createAgent('pt_26zjNr5yoewkZY9NefgnmH');
```

**Returns:**
```typescript
interface Agent {
  sandboxId: string;   // CodeSandbox ID
  url: string;         // Agent endpoint URL (prompt endpoint)
  baseUrl: string;     // Base URL with authentication token
  prompt: (message: string, options?: PromptOptions) => AsyncIterable<AgentMessage>;
  approve: (approvalId: string) => Promise<void>;
  reject: (approvalId: string) => Promise<void>;
  downloadFile: (filePath: string) => Promise<Response>;
  uploadFile: (filePath: string, content: Buffer | Uint8Array | Blob, contentType?: string) => Promise<Response>;
}
```

### `agent.prompt(message, options)`

Send a prompt to your agent and receive a stream of messages.

```typescript
for await (const message of agent.prompt('What is the weather in Paris?', {
  secrets: {
    API_KEY: 'your-api-key'
  }
})) {
  switch (message.type) {
    case 'text':
      console.log('Response:', message.content);
      break;
    case 'custom_tool_call_started':
      console.log(`Tool ${message.toolName} started`);
      break;
    case 'custom_tool_call_completed':
      console.log(`Tool ${message.toolName} completed:`, message.result);
      break;
    case 'error':
      console.error('Error:', message.error);
      break;
  }
}
```

**Parameters:**
```typescript
interface PromptOptions {
  secrets?: Record<string, string>;  // Secrets for tools
}
```

**Returns:**
An async iterable that yields `AgentMessage` objects. See [Message Types](#message-streaming) for all message types.

**Example - Collecting the final response:**
```typescript
let finalResponse = '';

for await (const message of agent.prompt('What is 2+2?')) {
  if (message.type === 'text') {
    finalResponse += message.content;
  }
}

console.log('Final response:', finalResponse);
```

**Example - Handling approvals:**
```typescript
for await (const message of agent.prompt('Send an email')) {
  switch (message.type) {
    case 'approval_request':
      // Handle approval request in your UI
      const approved = await askUser(message.payload);

      if (approved) {
        await agent.approve(message.approvalId);
      } else {
        await agent.reject(message.approvalId);
      }
      break;

    case 'error':
      console.error('Error:', message.error);
      break;

    case 'text':
      console.log(message.content);
      break;
  }
}
```

### `agent.approve(approvalId)`

Approve a pending approval request.

```typescript
await agent.approve(message.approvalId);
```

**Parameters:**
- `approvalId` (string): The approval ID from the `approval_request` message

**Returns:** `Promise<void>`

### `agent.reject(approvalId)`

Reject a pending approval request.

```typescript
await agent.reject(message.approvalId);
```

**Parameters:**
- `approvalId` (string): The approval ID from the `approval_request` message

**Returns:** `Promise<void>`

**Note:** When an approval is rejected, the tool execution will throw an error and the agent will receive a message that the user declined to proceed.

### `agent.uploadFile(filePath, content, contentType?)`

Upload a file to the agent's workspace. This allows you to send files (images, documents, data files, etc.) to the agent for processing.

```typescript
const fileBuffer = await fs.promises.readFile('./local-file.pdf');
const response = await agent.uploadFile('documents/report.pdf', fileBuffer, 'application/pdf');
const result = await response.json();
console.log(result); // { success: true, path: 'documents/report.pdf', size: 12345, message: '...' }
```

**Parameters:**
- `filePath` (string): Destination path within the workspace directory. Supports subdirectories (e.g., `uploads/images/photo.jpg`)
- `content` (Buffer | Uint8Array | Blob): The file content to upload
- `contentType` (string, optional): MIME type of the file (e.g., `'image/png'`, `'application/pdf'`)

**Returns:** `Promise<Response>` - A standard Fetch API Response object with upload result

**Behavior:**
- Automatically creates subdirectories if they don't exist
- Overwrites existing files at the same path
- Files can only be uploaded to the workspace directory
- Path traversal attempts (e.g., `../../etc/passwd`) are blocked

**Security:**
- Uploads are authenticated using the agent's host token
- Files are isolated within the workspace directory
- Cannot overwrite files outside the workspace

**Example - Upload from browser file input:**
```typescript
// React component with file upload
async function handleFileUpload(file: File) {
  // Send file to agent
  const response = await agent.uploadFile(
    `uploads/${file.name}`,
    file,
    file.type
  );

  const result = await response.json();
  console.log(`Uploaded: ${result.path} (${result.size} bytes)`);

  // Agent can now process the file via tools
  for await (const message of agent.prompt(`Analyze the uploaded file: ${file.name}`)) {
    if (message.type === 'text') {
      console.log(message.content);
    }
  }
}
```

**Example - Upload from Node.js:**
```typescript
import * as fs from 'fs/promises';

// Upload a local file
const fileBuffer = await fs.readFile('./data.csv');
await agent.uploadFile('data/input.csv', fileBuffer, 'text/csv');

// Agent can now process the file
for await (const message of agent.prompt('Parse the CSV file and summarize the data')) {
  if (message.type === 'text') {
    console.log(message.content);
  }
}
```

**Example - Upload to subdirectory:**
```typescript
// Create nested directory structure automatically
await agent.uploadFile('images/avatars/user123.png', imageBuffer, 'image/png');
await agent.uploadFile('documents/reports/2024/q1.pdf', pdfBuffer, 'application/pdf');
```

**Example tool that processes uploaded files:**
```typescript
// my-agent/analyzeImage.ts
import { z } from 'zod';
import { capability } from 'together-agent';
import * as fs from 'fs/promises';
import * as path from 'path';

export default capability({
  discoveryTerms: ['image', 'analyze', 'photo', 'picture', 'vision'],
  inputSchema: z.object({
    filename: z.string().describe('Name of the uploaded image file'),
  }),
  execute: async (input, context) => {
    // Read the uploaded file from workspace
    const filePath = path.join(context.workspacePath, input.filename);
    const imageBuffer = await fs.readFile(filePath);

    // Process the image (e.g., send to vision API)
    // ...

    return {
      success: true,
      analysis: 'Image contains...'
    };
  },
});
```

Then use it:
```typescript
// User uploads an image via your UI
const imageFile = document.getElementById('imageInput').files[0];
await agent.uploadFile(`uploads/${imageFile.name}`, imageFile, imageFile.type);

// Agent processes the uploaded image
for await (const message of agent.prompt(`Analyze the image I just uploaded: ${imageFile.name}`)) {
  if (message.type === 'text') {
    console.log(message.content);
  }
}
```

### `agent.downloadFile(filePath)`

Download a file from the agent's workspace. Tools can create files (PDFs, images, CSVs, etc.) in the workspace, and you can download them using this method.

```typescript
const response = await agent.downloadFile('report.pdf');
const buffer = await response.arrayBuffer();
fs.writeFileSync('./local-report.pdf', Buffer.from(buffer));
```

**Parameters:**
- `filePath` (string): Path to the file within the workspace directory. Supports subdirectories (e.g., `exports/report.pdf`)

**Returns:** `Promise<Response>` - A standard Fetch API Response object containing the file data

**Security:**
- Files can only be downloaded from the workspace directory
- Path traversal attempts (e.g., `../../etc/passwd`) are blocked
- Downloads are authenticated using the agent's host token

**Example - Stream to HTTP response:**
```typescript
// Next.js API route or Express endpoint
app.get('/api/download/:filename', async (req, res) => {
  const fileResponse = await agent.downloadFile(req.params.filename);

  // Forward headers (Content-Type, Content-Disposition, etc.)
  fileResponse.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  // Stream file to client
  const reader = fileResponse.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
});
```

**Example - Save to disk (Node.js):**
```typescript
const response = await agent.downloadFile('exports/data.csv');
const buffer = await response.arrayBuffer();
await fs.promises.writeFile('./downloaded-data.csv', Buffer.from(buffer));
```

**Example - Get file metadata:**
```typescript
const response = await agent.downloadFile('report.pdf');
console.log('Content-Type:', response.headers.get('Content-Type'));
console.log('File size:', response.headers.get('Content-Length'));
```

**Example tool that creates downloadable files:**
```typescript
// my-agent/generatePDF.ts
import { z } from 'zod';
import { capability } from 'together-agent';
import * as fs from 'fs/promises';
import * as path from 'path';
import PDFDocument from 'pdfkit';

export default capability({
  discoveryTerms: ['pdf', 'report', 'document', 'generate', 'create'],
  inputSchema: z.object({
    title: z.string().describe('Report title'),
    content: z.string().describe('Report content'),
  }),
  execute: async (input, context) => {
    // Create PDF in workspace
    const filename = `report-${Date.now()}.pdf`;
    const filePath = path.join(context.workspacePath, filename);

    // Generate PDF (simplified example)
    const doc = new PDFDocument();
    doc.pipe(fs.createWriteStream(filePath));
    doc.fontSize(24).text(input.title);
    doc.fontSize(12).text(input.content);
    doc.end();

    return {
      success: true,
      filename: filename,
      message: `PDF generated: ${filename}`
    };
  },
});
```

Then download it:
```typescript
// User: "Generate a sales report"
// Agent uses generatePDF tool, which returns: { filename: "report-1234567890.pdf" }

// Download the generated file
const response = await agent.downloadFile('report-1234567890.pdf');
const buffer = await response.arrayBuffer();
await fs.promises.writeFile('./sales-report.pdf', Buffer.from(buffer));
```

---

### Tool Definition API

### Basic Structure

The `capability()` function from `together-agent` defines capabilities with access to context (secrets and approvals).

```typescript
import { z } from 'zod';
import { capability, ToolExecutionContext } from 'together-agent';

export default capability({
  discoveryTerms: string[],
  inputSchema: z.ZodType,
  execute: async (input, context) => any
});
```

**Note:** Tools always return a function that takes `ToolExecutionContext`. The agent runtime automatically provides this context when loading tools.

### Named Exports (multiple tools in one file)

```typescript
import { capability } from 'together-agent';

export const toolOne = capability({
  discoveryTerms: string[],
  inputSchema: z.ZodType,
  execute: async (input, context) => any
});

export const toolTwo = capability({
  discoveryTerms: string[],
  inputSchema: z.ZodType,
  execute: async (input, context) => any
});
```

### `discoveryTerms`

**Array of keywords for tool discovery!** The `discoveryTerms` is an array of keywords used for tool discovery via regex matching. Include:
- Concrete, specific terms (not generic words like "data", "information", "get")
- Domain-specific terminology
- Synonyms and related terms
- Common variations

```typescript
// ❌ Bad - generic terms that match too broadly
discoveryTerms: ['get', 'data', 'information', 'from', 'location']

// ✅ Good - concrete, specific keywords
discoveryTerms: ['weather', 'forecast', 'temperature', 'climate', 'celsius', 'fahrenheit', 'rain', 'snow', 'wind', 'humidity', 'precipitation', 'atmospheric']
```

Use concrete terms that clearly identify what the tool does. Avoid generic words that could apply to many tools.

### `inputSchema`

Zod schema defining capability parameters. The `capability()` function provides full type safety - the `execute` function will have correctly typed input based on your schema.

```typescript
inputSchema: z.object({
  location: z.string().describe('City name or coordinates'),
  units: z.enum(['fahrenheit', 'celsius']).optional(),
  includeForecast: z.boolean().default(false),
})
```

**Best practices:**
- Always use `.describe()` on each field
- Use appropriate Zod types (string, number, boolean, enum, etc.)
- Mark optional fields with `.optional()` or `.default()`
- Use enums for constrained values

**Type safety example:**
```typescript
import { capability } from 'together-agent';
import { z } from 'zod';

export default capability({
  discoveryTerms: ['weather', 'temperature', 'forecast'],
  inputSchema: z.object({
    location: z.string(),
    units: z.enum(['fahrenheit', 'celsius']).optional(),
  }),
  execute: async (input, context) => {
    // ✅ TypeScript knows:
    // - input.location is string
    // - input.units is 'fahrenheit' | 'celsius' | undefined
    return { temperature: 72 };
  },
});
```

### `execute`

Async function that performs the tool's action. Receives two parameters:

1. **`input`** - The validated input parameters (typed based on your schema)
2. **`context`** - The `ToolExecutionContext` with `secrets`, `requestApproval`, and `workspacePath`
```typescript
execute: async (input, context) => {
  // Access validated input (fully typed)
  const { location, units } = input;

  // Access secrets from context
  const apiKey = context.secrets.WEATHER_API_KEY;

  // Access workspace path for file operations
  const workspacePath = context.workspacePath;

  // Perform action
  const data = await fetchWeatherData(location, apiKey);

  // Return structured result
  return {
    temperature: data.temp,
    condition: data.condition,
  };
}
```

**Best practices:**
- Always use `async`
- Handle errors with clear messages
- Return structured data (objects, arrays)
- Log useful information with `console.log()` during debugging
- Check `options.abortSignal` for long-running operations

---

## Best Practices

### Tool Descriptions

✅ **Do:**
- Use concrete, specific keywords (e.g., "email", "weather", "database")
- Add domain-specific terminology (e.g., "SMTP", "celsius", "SQL")
- Include synonyms and variations (e.g., "mail message correspondence")
- Think about specific user intents

❌ **Don't:**
- Use generic terms like "data", "information", "get", "set", "find"
- Write full sentences or natural language
- Use vague terms that apply to multiple tools

### Error Handling

```typescript
execute: async (input, context) => {
  // Validate inputs
  if (!input.email.includes('@')) {
    throw new Error('Invalid email format');
  }

  // Check secrets
  const apiKey = context.secrets.API_KEY;
  if (!apiKey) {
    throw new Error('API_KEY environment variable is required');
  }

  // Handle API errors
  try {
    const result = await callAPI(input.email, apiKey);
    return result;
  } catch (error) {
    throw new Error(`API call failed: ${error.message}`);
  }
}
```

### Parallel Tool Execution

When tools are independent, the agent can execute them in parallel:

```javascript
// Agent generates:
const [weather, news] = await Promise.all([
  tools.getWeather({ location: "Paris" }),
  tools.searchNews({ query: "Paris" })
]);
```

This is automatic - design tools to be independent when possible.

### Rate Limiting

**🟡 Important: Implement rate limiting for expensive operations**

The SDK doesn't limit how many times tools are called. Without rate limiting, the AI could make excessive API calls that cost money.

**Example implementation:**
```typescript
import { capability } from 'together-agent';

// Simple counter-based rate limiting
let callCount = 0;
const MAX_CALLS_PER_SESSION = 10;
const SESSION_TIMEOUT = 60000; // 1 minute

let sessionStart = Date.now();

export default capability({
  discoveryTerms: ['search', 'web', 'query', 'find', 'lookup'],
  inputSchema: z.object({
    query: z.string(),
  }),
  execute: async (input, context) => {
    // Reset counter if session expired
    if (Date.now() - sessionStart > SESSION_TIMEOUT) {
      callCount = 0;
      sessionStart = Date.now();
    }

    // Check rate limit
    if (callCount >= MAX_CALLS_PER_SESSION) {
      throw new Error('Rate limit exceeded. Maximum 10 searches per minute.');
    }

    callCount++;

    // Make API call
    const apiKey = context.secrets.BRAVE_API_KEY;
    return await searchWeb(input.query, apiKey);
  }
})
```

**For more sophisticated rate limiting:**
- Use a token bucket algorithm
- Implement per-user limits (if you track users)
- Add costs/quotas for different operations
- Consider using a rate limiting library

### Return Structured Data

**🟢 Optional: Return clean, structured objects**

Unstructured data is harder for the AI to work with and may accidentally include sensitive information.

**Example:**
```typescript
execute: async (input, context) => {
  const apiKey = context.secrets.WEATHER_API_KEY;
  const response = await fetch(`https://api.weather.com?location=${input.location}`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });

  const rawData = await response.json();

  // ❌ DON'T: Return entire response (may include metadata, API keys, etc.)
  // return rawData;

  // ✅ DO: Return only what's needed
  return {
    success: true,
    data: {
      temperature: rawData.main.temp,
      condition: rawData.weather[0].description
    }
  };
}
```

---

## Environment Variables

### `TOGETHER_API_KEY` (required)

Your Together AI API key. Get one at [together.ai](https://www.together.ai)

```bash
export TOGETHER_API_KEY="your-key"
```

Used for:
- AI model inference
- CodeSandbox deployment (Together keys work with CodeSandbox)

### Tool-specific variables

Passed via `.env` file (CLI) or `options.secrets` (Node.js):

```bash
# CLI - Create a .env file:
# .env
# BRAVE_API_KEY=abc
# SENDGRID_KEY=xyz

together-agent run ./my-agent

# Node.js
await agent.prompt('message', {
  secrets: {
    BRAVE_API_KEY: 'abc',
    SENDGRID_KEY: 'xyz'
  }
});
```

---

## Troubleshooting

### "TOGETHER_API_KEY environment variable is required"

**Solution:** Set your API key:
```bash
export TOGETHER_API_KEY="your-key"
```

Or pass it when creating the client:
```typescript
const sdk = new TogetherAgentSDK({ apiKey: 'your-key' });
```

### "Agent directory not found"

**Solution:** Verify the path exists:
```bash
ls ./my-agent  # Should show your .ts files
```

### Tool not being discovered

**Solution:** Add more specific keywords to the tool's description:
```typescript
// Add concrete, domain-specific terms
description: 'weather forecast temperature climate celsius fahrenheit rain snow sunny cloudy wind humidity barometric'
```

Avoid generic terms like "data", "information", "get" - use specific terms like "weather", "email", "database".

### "Environment variable is required" error

**Solution:** Make sure you're passing secrets:

**CLI:**
Create a `.env` file in your current directory:
```bash
# .env
MY_VAR=value
```

Then run your agent:
```bash
together-agent run ./my-agent
```

**Node.js:**
```typescript
await agent.prompt('message', {
  secrets: { MY_VAR: 'value' }
});
```

### Deployment fails

**Checklist:**
- Agent directory contains valid TypeScript files
- `package.json` and `tsconfig.json` exist
- `npm run build` succeeds locally
- `TOGETHER_API_KEY` is set correctly

### TypeScript compilation errors

**Solution:** Make sure your `tsconfig.json` has:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "./dist"
  }
}
```

---

## Examples

### Weather Tool

```typescript
// my-agent/getWeather.ts
import { z } from 'zod';
import { capability } from 'together-agent';

export default capability({
  discoveryTerms: ['weather', 'forecast', 'temperature', 'climate', 'meteorology', 'fahrenheit', 'celsius', 'precipitation', 'rain', 'snow', 'drizzle', 'hail', 'storm', 'thunderstorm', 'wind', 'humidity', 'barometric', 'pressure', 'sunny', 'cloudy', 'overcast', 'foggy'],
  inputSchema: z.object({
    location: z.string().describe('City name, region, or coordinates'),
    units: z.enum(['fahrenheit', 'celsius']).default('fahrenheit').describe('Temperature units (fahrenheit or celsius)'),
  }),

  execute: async (input, context) => {
    const apiKey = context.secrets.WEATHER_API_KEY;

    if (!apiKey) {
      throw new Error('WEATHER_API_KEY is required');
    }

    const response = await fetch(
      `https://api.weather.com/v1/current?location=${input.location}&units=${input.units}&key=${apiKey}`
    );

    if (!response.ok) {
      throw new Error(`Weather API error: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      location: input.location,
      temperature: data.temp,
      units: input.units,
      condition: data.weather,
      humidity: data.humidity,
      windSpeed: data.wind_speed,
      feelsLike: data.feels_like,
    };
  },
});
```

### Email Tool with Approval

```typescript
// my-agent/sendEmail.ts
import { z } from 'zod';
import { capability } from 'together-agent';

export default capability({
  discoveryTerms: ['email', 'send', 'mail', 'SMTP', 'message', 'recipient', 'address', 'inbox', 'outbox', 'compose', 'deliver', 'notification', 'alert', 'reminder', 'newsletter', 'sendgrid', 'mailgun', 'postmark'],
  inputSchema: z.object({
    to: z.string().describe('Recipient email address'),
    subject: z.string().describe('Email subject line'),
    body: z.string().describe('Email body content'),
  }),

  execute: async (input, context) => {
    // Request approval before sending
    await context.requestApproval({
      action: 'send_email',
      to: input.to,
      subject: input.subject,
      preview: input.body.substring(0, 100),
      warning: 'This will send a real email to the recipient',
    }, 30000);  // 30 second timeout

    const apiKey = context.secrets.SENDGRID_API_KEY;

    if (!apiKey) {
      throw new Error('SENDGRID_API_KEY is required');
    }

    // Send email via SendGrid
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: input.to }] }],
        from: { email: 'noreply@example.com' },
        subject: input.subject,
        content: [{ type: 'text/plain', value: input.body }],
      }),
    });

    if (!response.ok) {
      throw new Error(`SendGrid error: ${response.statusText}`);
    }

    return {
      success: true,
      messageId: response.headers.get('X-Message-Id') || 'unknown',
    };
  },
});
```

### Database Query Tool

```typescript
// my-agent/queryDatabase.ts
import { z } from 'zod';
import { capability } from 'together-agent';

export default capability({
  discoveryTerms: ['database', 'query', 'SQL', 'SELECT', 'WHERE', 'table', 'column', 'row', 'record', 'postgres', 'mysql', 'sqlite', 'mongodb', 'collection', 'document', 'filter', 'JOIN', 'aggregate'],
  inputSchema: z.object({
    table: z.string().describe('Table or collection name'),
    filters: z.record(z.any()).optional().describe('Filter conditions'),
    limit: z.number().default(10),
  }),

  execute: async (input, context) => {
    const dbUrl = context.secrets.DATABASE_URL;

    if (!dbUrl) {
      throw new Error('DATABASE_URL is required');
    }

    // Build and execute query (simplified example)
    console.log(`Querying table: ${input.table}`);
    console.log(`Filters:`, input.filters);

    // Simulate query execution
    const results = [
      { id: 1, name: 'Example', created: new Date() }
    ];

    return {
      table: input.table,
      count: results.length,
      results: results.slice(0, input.limit),
    };
  },
});
```

### File Operations Tool

```typescript
// my-agent/saveFile.ts
import { z } from 'zod';
import { capability } from 'together-agent';
import * as fs from 'fs/promises';
import * as path from 'path';

export default capability({
  discoveryTerms: ['file', 'save', 'write', 'store', 'disk', 'filesystem', 'document', 'text', 'data', 'create', 'persist'],
  inputSchema: z.object({
    filename: z.string().describe('Name of the file to save'),
    content: z.string().describe('Content to write to the file'),
  }),

  execute: async (input, context) => {
    // Use the workspace path from context
    const filePath = path.join(context.workspacePath, input.filename);

    // Write file to workspace
    await fs.writeFile(filePath, input.content, 'utf-8');

    return {
      success: true,
      path: filePath,
      size: Buffer.byteLength(input.content, 'utf-8'),
    };
  },
});
```

```typescript
// my-agent/readFile.ts
import { z } from 'zod';
import { capability } from 'together-agent';
import * as fs from 'fs/promises';
import * as path from 'path';

export default capability({
  discoveryTerms: ['file', 'read', 'load', 'open', 'retrieve', 'fetch', 'get', 'document', 'text', 'data'],
  inputSchema: z.object({
    filename: z.string().describe('Name of the file to read'),
  }),

  execute: async (input, context) => {
    // Use the workspace path from context
    const filePath = path.join(context.workspacePath, input.filename);

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch (error) {
      throw new Error(`File not found: ${input.filename}`);
    }

    // Read file from workspace
    const content = await fs.readFile(filePath, 'utf-8');
    const stats = await fs.stat(filePath);

    return {
      filename: input.filename,
      content,
      size: stats.size,
      modified: stats.mtime,
    };
  },
});
```

---

## License

MIT
