# Together Agent

Build AI agents with custom tools powered by Together AI.

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

1. **Closure-based isolation** - Secrets are exposed to your tool definitions via a closure:
   ```typescript
   export default (context) => ({
     execute: async (params) => {
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

## Security Best Practices for Tool Developers

When building custom tools for Together Agent, follow these guidelines to ensure your tools remain secure and don't accidentally expose sensitive information.

### 🔴 Critical: Never Log Secrets

**Problem:** Console output from tools is visible to the AI model. If you log secrets, the AI can see them in execution results.

❌ **DON'T DO THIS:**
```typescript
export default (context) => ({
  execute: async (params) => {
    const apiKey = context.secrets.API_KEY;
    console.log("Using API key:", apiKey);  // ❌ DANGEROUS! Exposes secret to AI
    console.log("Full context:", context);   // ❌ DANGEROUS! Exposes all secrets

    const response = await callAPI(apiKey);
    return response;
  }
})
```

✅ **DO THIS INSTEAD:**
```typescript
export default (context) => ({
  execute: async (params) => {
    const apiKey = context.secrets.API_KEY;
    console.log("Calling API...");           // ✅ SAFE - no secret exposed

    const response = await callAPI(apiKey);
    console.log("API call completed");       // ✅ SAFE - generic message
    return response;
  }
})
```

**Why this matters:** While the SDK prevents AI-generated code from accessing `context.secrets` directly, YOUR tool code CAN access secrets. If you accidentally log them, they become visible to the AI in the console output.

### 🔴 Critical: Sanitize Error Messages

**Problem:** Error messages are returned to the AI. Exceptions that include secrets or sensitive information will leak them.

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

### 🟡 Important: Use Approval for Sensitive Actions

**Problem:** Without approval, the AI can perform destructive or costly actions without user confirmation.

**Examples of actions that need approval:**
- Sending emails
- Making purchases or payments
- Deleting data
- Modifying important records
- Posting to social media
- Making expensive API calls

✅ **Implement approval for sensitive actions:**
```typescript
export default (context) => ({
  description: 'Send an email to a recipient',
  execute: async ({ to, subject, body }) => {
    // Request approval BEFORE performing the action
    await context.requestApproval({
      action: 'send_email',
      to,
      subject,
      body: body.substring(0, 200), // Show preview
      warning: 'This will send a real email to the recipient'
    });

    // Only proceeds if user approves
    const apiKey = context.secrets.SENDGRID_API_KEY;
    await sendEmail(to, subject, body, apiKey);

    return { success: true };
  }
})
```

**When approval is rejected:**
- The `requestApproval()` call throws an error
- Tool execution stops immediately
- AI receives an error message that user declined

### 🟡 Important: Implement Rate Limiting for Expensive Operations

**Problem:** The SDK doesn't limit how many times tools are called. Without rate limiting, the AI could make excessive API calls that cost money.

✅ **Add per-session rate limiting:**
```typescript
// Simple counter-based rate limiting
let callCount = 0;
const MAX_CALLS_PER_SESSION = 10;
const SESSION_TIMEOUT = 60000; // 1 minute

let sessionStart = Date.now();

export default (context) => ({
  description: 'Search the web',
  execute: async ({ query }) => {
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
    return await searchWeb(query, apiKey);
  }
})
```

**For more sophisticated rate limiting:**
- Use a token bucket algorithm
- Implement per-user limits (if you track users)
- Add costs/quotas for different operations
- Consider using a rate limiting library

### 🟢 Optional: Validate Secrets Early

**Problem:** Missing secrets cause tool execution to fail, wasting time and tokens.

✅ **Check for required secrets immediately:**
```typescript
export default (context) => ({
  execute: async (params) => {
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
    return await callAPI(apiKey, params);
  }
})
```

### 🟢 Optional: Return Structured Data

**Problem:** Unstructured data is harder for the AI to work with and may accidentally include sensitive information.

✅ **Return clean, structured objects:**
```typescript
export default (context) => ({
  outputSchema: z.object({
    success: z.boolean(),
    data: z.object({
      temperature: z.number(),
      condition: z.string()
    })
  }),

  execute: async ({ location }) => {
    const apiKey = context.secrets.WEATHER_API_KEY;
    const response = await fetch(`https://api.weather.com?location=${location}`, {
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
})
```

### Security Checklist for Tool Development

Before deploying your tools, verify:

- [ ] **No secrets in console.log statements**
- [ ] **No secrets in error messages**
- [ ] **No secrets in return values** (unless intentionally returned)
- [ ] **Error messages are sanitized** (no stack traces, file paths)
- [ ] **Approval required for sensitive actions** (email, payments, deletions)
- [ ] **Rate limiting implemented** for expensive operations
- [ ] **Secrets validated early** (clear error messages if missing)
- [ ] **Return values are structured** (use outputSchema)
- [ ] **Input validation beyond Zod** (business logic checks)
- [ ] **API responses are filtered** (only return necessary data)

### What the SDK Protects You From

You don't need to worry about:

✅ **AI accessing secrets directly** - The SDK ensures AI-generated code cannot access `context.secrets`
✅ **AI importing malicious packages** - `require()` and `import` are blocked
✅ **AI using eval or code generation** - These functions are forbidden
✅ **AI accessing system resources** - No access to `process`, `global`, filesystem, etc.
✅ **AI inspecting tool source code** - Tools are wrapped to hide implementation

### What YOU Need to Protect

You are responsible for:

⚠️ **Not logging secrets** - Console output is visible to AI
⚠️ **Not including secrets in errors** - Error messages are visible to AI
⚠️ **Implementing approval flows** - SDK provides the mechanism, you decide when to use it
⚠️ **Rate limiting expensive operations** - SDK doesn't limit tool calls
⚠️ **Sanitizing tool outputs** - Ensure returned data doesn't leak sensitive info

---

## Defining Your Agent

Your agent consists of tools that are TypeScript modules:

```typescript
// my-agent/getWeather.ts
import { z } from 'zod';

export default {
  description: 'weather forecast temperature climate conditions degrees fahrenheit celsius rain snow wind humidity',
  inputSchema: z.object({
    location: z.string().describe('City name'),
  }),
  execute: async ({ location }) => {
    // Your implementation
    return { temperature: 72, condition: 'sunny' };
  },
}
```

**With environment variables (secrets):**

```typescript
// my-agent/sendEmail.ts
export default (context) => ({
  description: 'email send message mail recipient address notification letter correspondence',
  inputSchema: z.object({
    to: z.string().describe('Email address'),
    subject: z.string().describe('Subject line'),
    body: z.string().describe('Email content'),
  }),
  execute: async ({ to, subject, body }) => {
    const apiKey = context.secrets.SENDGRID_API_KEY;
    // Send email using apiKey
    return { success: true };
  },
})
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

#### 2. `execute_tools`
Executes JavaScript code with access to your custom tools.

```javascript
// Agent generates and executes:
const weather = await tools.getWeather({ location: "Paris" });
console.log(weather);
```

The code is validated for safety (no `require()`, `import`, `eval()`, etc.) and executed in a sandboxed environment.

#### 3. `execute_code`
Executes arbitrary JavaScript for computation, data manipulation, etc.

```javascript
// For tasks like calculations:
const result = Math.sqrt(144) * 2;
console.log(result);
```

No access to tools or external resources - only base JavaScript (Array, Object, Math, Date, etc.).

### Execution Flow

```
1. User sends prompt → "What's the weather in Paris?"

2. Agent discovers tools
   discover_tools("weather forecast temperature")
   → matches: ["getWeather"]

3. Agent generates code
   execute_tools(`
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

## Secrets Management

Tools often need API keys, credentials, or configuration. Together Agent provides a secure way to pass these at runtime.

### Tool Context

Every tool receives a `context` object with:

```typescript
interface ToolExecutionContext {
  secrets: Record<string, string>;        // Environment variables
  requestApproval: (payload, timeout) => Promise<void>;  // User approval
}
```

### Accessing Secrets

Export a function instead of an object to access context:

```typescript
// my-agent/searchWeb.ts
export default (context) => ({
  description: 'web search internet browser google bing brave online webpage website url link crawl index',
  inputSchema: z.object({
    query: z.string(),
  }),
  execute: async ({ query }) => {
    const apiKey = context.secrets.BRAVE_API_KEY;

    if (!apiKey) {
      throw new Error('BRAVE_API_KEY is required');
    }

    // Use the API key
    const response = await fetch(`https://api.brave.com?key=${apiKey}`);
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

---

## Approval System

Some tools perform sensitive actions (send emails, delete data, charge cards). The approval system lets you request user confirmation before execution.

### Requesting Approval

```typescript
export default (context) => ({
  description: 'Send an email to a recipient',
  inputSchema: z.object({
    to: z.string(),
    subject: z.string(),
    body: z.string(),
  }),
  execute: async ({ to, subject, body }) => {
    // Request approval before sending
    await context.requestApproval({
      action: 'send_email',
      to,
      subject,
      body,
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
  url: string;         // Agent endpoint URL
  prompt: (message: string, options?: PromptOptions) => AsyncIterable<AgentMessage>;
  approve: (approvalId: string) => Promise<void>;
  reject: (approvalId: string) => Promise<void>;
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

---

### Tool Definition API

### Basic Structure

```typescript
import { z } from 'zod';

export default {
  description: string,
  inputSchema: z.ZodType,
  outputSchema?: z.ZodType,  // Optional
  execute: async (params) => any
}
```

### With Context (for secrets/approval)

```typescript
export default (context: ToolExecutionContext) => ({
  description: string,
  inputSchema: z.ZodType,
  outputSchema?: z.ZodType,
  execute: async (params, context) => any
})
```

### `description`

**Use keywords for matching!** The description is a space-separated list of keywords used for tool discovery via regex matching. Include:
- Concrete, specific terms (not generic words like "data", "information", "get")
- Domain-specific terminology
- Synonyms and related terms
- Common variations

```typescript
// ❌ Bad - generic terms that match too broadly
description: 'get data information from location'

// ✅ Good - concrete, specific keywords
description: 'weather forecast temperature climate celsius fahrenheit rain snow wind humidity precipitation atmospheric'
```

Use concrete terms that clearly identify what the tool does. Avoid generic words that could apply to many tools.

### `inputSchema`

Zod schema defining tool parameters.

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

### `outputSchema` (optional)

Zod schema defining the expected output structure.

```typescript
outputSchema: z.object({
  temperature: z.number().describe('Temperature value'),
  condition: z.string().describe('Weather condition'),
  humidity: z.number().optional(),
})
```

Helps the AI understand what data your tool returns.

### `execute`

Async function that performs the tool's action.

```typescript
execute: async (params, context?) => {
  // Access validated input
  const { location, units } = params;

  // Access secrets (if using context)
  const apiKey = context?.secrets.WEATHER_API_KEY;

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
execute: async ({ email }) => {
  // Validate inputs
  if (!email.includes('@')) {
    throw new Error('Invalid email format');
  }

  // Check secrets
  const apiKey = context.secrets.API_KEY;
  if (!apiKey) {
    throw new Error('API_KEY environment variable is required');
  }

  // Handle API errors
  try {
    const result = await callAPI(email, apiKey);
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

### Security

- **Never hardcode secrets** - always use `context.secrets`
- **Request approval** for sensitive actions (email, payments, deletions)
- **Validate inputs** thoroughly in your execute function
- **Sanitize outputs** if they'll be displayed to users

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

export default (context) => ({
  description: 'weather forecast temperature climate meteorology fahrenheit celsius precipitation rain snow drizzle hail storm thunderstorm wind humidity barometric pressure sunny cloudy overcast foggy',

  inputSchema: z.object({
    location: z.string().describe('City name, region, or coordinates'),
    units: z.enum(['fahrenheit', 'celsius']).default('fahrenheit'),
  }),

  outputSchema: z.object({
    temperature: z.number(),
    condition: z.string(),
    humidity: z.number(),
    windSpeed: z.number(),
  }),

  execute: async ({ location, units }) => {
    const apiKey = context.secrets.WEATHER_API_KEY;

    if (!apiKey) {
      throw new Error('WEATHER_API_KEY is required');
    }

    const response = await fetch(
      `https://api.weather.com/v1/current?location=${location}&units=${units}&key=${apiKey}`
    );

    if (!response.ok) {
      throw new Error(`Weather API error: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      temperature: data.temp,
      condition: data.weather,
      humidity: data.humidity,
      windSpeed: data.wind_speed,
    };
  },
});
```

### Email Tool with Approval

```typescript
// my-agent/sendEmail.ts
import { z } from 'zod';

export default (context) => ({
  description: 'email send mail SMTP message recipient address inbox outbox compose deliver notification alert reminder newsletter sendgrid mailgun postmark',

  inputSchema: z.object({
    to: z.string().describe('Recipient email address'),
    subject: z.string().describe('Email subject line'),
    body: z.string().describe('Email body content'),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    messageId: z.string(),
  }),

  execute: async ({ to, subject, body }) => {
    // Request approval before sending
    await context.requestApproval({
      action: 'send_email',
      to,
      subject,
      preview: body.substring(0, 100),
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
        personalizations: [{ to: [{ email: to }] }],
        from: { email: 'noreply@example.com' },
        subject,
        content: [{ type: 'text/plain', value: body }],
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

export default (context) => ({
  description: 'database query SQL SELECT WHERE table column row record postgres mysql sqlite mongodb collection document filter JOIN aggregate',

  inputSchema: z.object({
    table: z.string().describe('Table or collection name'),
    filters: z.record(z.any()).optional().describe('Filter conditions'),
    limit: z.number().default(10),
  }),

  execute: async ({ table, filters, limit }) => {
    const dbUrl = context.secrets.DATABASE_URL;

    if (!dbUrl) {
      throw new Error('DATABASE_URL is required');
    }

    // Build and execute query (simplified example)
    console.log(`Querying table: ${table}`);
    console.log(`Filters:`, filters);

    // Simulate query execution
    const results = [
      { id: 1, name: 'Example', created: new Date() }
    ];

    return {
      table,
      count: results.length,
      results: results.slice(0, limit),
    };
  },
});
```

---

## License

MIT
