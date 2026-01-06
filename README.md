# Together Agent SDK

A TypeScript SDK and CLI for building and deploying AI agents with custom tools powered by Together AI's API.

## Installation

```bash
npm install together-agent-sdk
```

For CLI usage, install globally:

```bash
npm install -g together-agent-sdk
```

Or use directly with npx:

```bash
npx together-agent-sdk
```

## Quick Start

### Development Workflow

1. **Initialize** a tools directory
2. **Run** locally to test your agent
3. **Deploy** to CodeSandbox for production
4. **Use** the Node.js SDK to interact with your deployed agent

### 1. Initialize a Tools Directory

Create a new tools directory with an example tool:

```bash
together-agent init ./tools
```

This creates:
- A `tools/` directory with a sample `getWeather.js` tool
- A `package.json` with required dependencies (zod)
- Automatically installs dependencies

### 2. Set Up Environment Variables

The SDK requires a Together AI API key:

```bash
export TOGETHER_API_KEY="your-together-api-key"
```

Get your API key at [together.ai](https://www.together.ai)

### 3. Run Locally to Test

Start the agent server and interact with your tools:

```bash
together-agent run ./tools
```

With options:

```bash
together-agent run ./tools --port 3000 --env BRAVE_SEARCH_API_KEY=your-key --env OTHER_API_KEY=another-key
```

This starts an interactive session where you can test your agent locally.

### 4. Deploy to Production

Once you've tested locally, deploy your agent to CodeSandbox:

```bash
together-agent deploy ./tools
```

This will:
- Package your tools and agent
- Deploy to CodeSandbox
- Return your agent template ID and endpoint URL

Example output:
```
✓ Deployment complete!

Agent template id: pt_26zjNr5yoewkZY9NefgnmH

POST https://6mtpjl-3000.csb.app/prompt
{
  "prompt": "How are you?",
  "apiKey": "",
  "env": {}
}
```

### 5. Use the Node.js SDK

After deploying, use the SDK to interact with your agent programmatically:

```typescript
import { TogetherAgentSDK } from 'together-agent-sdk';

// Initialize SDK with your Together AI API key
const sdk = new TogetherAgentSDK({
  apiKey: process.env.TOGETHER_API_KEY // or pass directly
});

// Create an agent from your deployed template
const agent = await sdk.createAgent('pt_26zjNr5yoewkZY9NefgnmH');

// Send prompts to your agent
const result = await agent.prompt('What is the weather in San Francisco?', {
  env: {
    // Pass environment variables your tools need
    BRAVE_SEARCH_API_KEY: process.env.BRAVE_SEARCH_API_KEY
  }
});

console.log(result.response);

// Continue the conversation with session support
const followUp = await agent.prompt('How about New York?', {
  sessionId: result.sessionId // Maintains conversation context
});
```

## Complete Example

Here's a complete workflow from initialization to production usage:

```bash
# 1. Set up your API key
export TOGETHER_API_KEY="your-together-api-key"

# 2. Initialize a new project
together-agent init ./my-agent-tools

# 3. Add your custom tools to ./my-agent-tools/
# (Edit the files or add new .js files)

# 4. Test locally
together-agent run ./my-agent-tools

# In the interactive prompt:
# > What's the weather in London?
# > exit

# 5. Deploy to production
together-agent deploy ./my-agent-tools

# Output shows your template ID: pt_26zjNr5yoewkZY9NefgnmH
```

Then use it in your application:

```typescript
// app.ts
import { TogetherAgentSDK } from 'together-agent-sdk';

const sdk = new TogetherAgentSDK({
  apiKey: process.env.TOGETHER_API_KEY
});

const agent = await sdk.createAgent('pt_26zjNr5yoewkZY9NefgnmH');

// Use the agent
const result = await agent.prompt('What is the weather in London?');
console.log(result.response);
```

## CLI Commands

### `init <path>`

Initialize a new tools directory with example files.

```bash
together-agent init ./my-tools
```

**Arguments:**
- `<path>` - Path where the tools directory will be created

### `run <tools-path>`

Start the agent server locally and begin an interactive session for testing.

```bash
together-agent run ./tools [options]
```

**Arguments:**
- `<tools-path>` - Path to the directory containing your tool files

**Options:**
- `-p, --port <port>` - Port to run the agent server on (default: 3000)
- `-e, --env <KEY=VALUE>` - Environment variables to pass to tools (can be specified multiple times)

**Examples:**

```bash
# Basic usage
together-agent run ./tools

# Custom port
together-agent run ./tools --port 8080

# Pass environment variables to tools
together-agent run ./tools --env API_KEY=abc123 --env API_URL=https://api.example.com

# Combine options
together-agent run ./tools -p 8080 -e API_KEY=abc123
```

### `deploy <tools-path>`

Deploy your agent to CodeSandbox for production use.

```bash
together-agent deploy ./tools
```

**Arguments:**
- `<tools-path>` - Path to the directory containing your tool files

**What it does:**
1. Creates a temporary deployment package with your tools and agent
2. Deploys to CodeSandbox using the Together AI API key
3. Returns the agent template ID and endpoint URL

**Output:**
- **Agent template id**: Use this with the Node.js SDK to create agent instances
- **POST URL**: The endpoint URL with example payload structure

**Example:**

```bash
together-agent deploy ./tools

# Output:
# ✓ Deployment complete!
#
# Agent template id: pt_26zjNr5yoewkZY9NefgnmH
#
# POST https://6mtpjl-3000.csb.app/prompt
# {
#   "prompt": "How are you?",
#   "apiKey": "",
#   "env": {}
# }
```

## Node.js SDK API

### `TogetherAgentSDK`

The main SDK class for interacting with deployed agents.

```typescript
import { TogetherAgentSDK } from 'together-agent-sdk';

const sdk = new TogetherAgentSDK({
  apiKey: 'your-together-api-key' // Optional, defaults to TOGETHER_API_KEY env var
});
```

**Constructor Options:**
- `apiKey` (optional): Your Together AI API key. If not provided, uses `TOGETHER_API_KEY` environment variable.

### `sdk.createAgent(templateId)`

Creates an agent instance from a deployed template.

```typescript
const agent = await sdk.createAgent('pt_26zjNr5yoewkZY9NefgnmH');
```

**Parameters:**
- `templateId` (string): The template ID returned from `together-agent deploy`

**Returns:** An `Agent` object with the following properties:
- `sandboxId` (string): The CodeSandbox sandbox ID
- `url` (string): The agent endpoint URL
- `prompt(message, options)`: Method to send prompts to the agent

### `agent.prompt(message, options)`

Send a prompt to your agent.

```typescript
const result = await agent.prompt('What is the weather?', {
  env: {
    API_KEY: 'your-api-key'
  },
  sessionId: 'previous-session-id' // Optional, for conversation continuity
});
```

**Parameters:**
- `message` (string): The prompt to send to the agent
- `options` (optional object):
  - `env` (Record<string, string>): Environment variables to pass to your tools
  - `sessionId` (string): Session ID for continuing a previous conversation

**Returns:** A `PromptResult` object:
```typescript
{
  success: boolean;
  response?: string;        // The agent's response
  sessionId?: string;       // Session ID for follow-up prompts
  error?: string;           // Error message if success is false
  timestamp?: string;       // ISO timestamp
}
```

**Example with session continuity:**

```typescript
// First prompt
const result1 = await agent.prompt('What is the weather in Paris?');
console.log(result1.response);

// Follow-up prompt with same session
const result2 = await agent.prompt('How about tomorrow?', {
  sessionId: result1.sessionId
});
console.log(result2.response);
```

## Environment Variables

### Required

- `TOGETHER_API_KEY` - Your Together AI API key (get one at [together.ai](https://www.together.ai))

**Note:** The Together AI API key is used for both the AI model and CodeSandbox deployment. You only need one API key.

### Tool-Specific Variables

Environment variables passed via `--env` (CLI) or `options.env` (SDK) are available to your tools. Common examples:

- `BRAVE_SEARCH_API_KEY` - For web search tools using Brave Search API
- Any custom API keys or configuration your tools need

**CLI Example:**

```bash
export TOGETHER_API_KEY="your-together-key"
together-agent run ./tools --env BRAVE_SEARCH_API_KEY="your-brave-key"
```

**SDK Example:**

```typescript
const result = await agent.prompt('Search for latest news', {
  env: {
    BRAVE_SEARCH_API_KEY: 'your-brave-key'
  }
});
```

## Creating Tools

Tools are JavaScript/ES6 modules that export a default object with the following fields:

### Tool Structure

```javascript
import { z } from 'zod';

export default {
  description: 'Your tool description',
  inputSchema: z.object({
    param: z.string().describe('Parameter description'),
  }),
  outputSchema: z.object({
    result: z.string().describe('Result description'),
  }),
  execute: async (params) => {
    // Your tool logic
    return result;
  },
}
```

### Tool Fields

#### 1. `description` (string)

**IMPORTANT:** The description should be **verbose and keyword-rich**. This description is used by the AI to discover which tools to use, but it is **NOT passed as payload** to the API - so make it as detailed as possible without worrying about token costs.

Include:
- **Primary function**: What the tool does
- **Use cases**: When and why to use it
- **Synonyms & related terms**: Alternative words users might search for
- **Specific capabilities**: Detailed features and data it can provide
- **Domain-specific keywords**: Technical terms relevant to the tool's purpose

**Example of a good description:**

```javascript
description: "Get weather forecast temperature climate atmospheric conditions meteorology for any location city place region area. Check current real-time temperature degrees fahrenheit celsius hot cold warm cool. Find precipitation rain snow drizzle hail showers storms thunderstorms. Check wind speed direction gusts. Get humidity moisture levels atmospheric pressure. See sky conditions clear cloudy overcast sunny foggy. Weather forecast outdoor outside conditions feels-like apparent temperature wind-chill heat-index."
```

This helps the AI discover the tool when users ask questions like:
- "What's the temperature in Boston?"
- "Is it raining in Seattle?"
- "What's the weather forecast for Tokyo?"
- "How humid is it in Miami?"

#### 2. `inputSchema` (Zod schema)

Define the parameters your tool accepts using Zod schemas. Each parameter should have a clear description.

```javascript
inputSchema: z.object({
  location: z.string().describe('The city name or location'),
  units: z.enum(['fahrenheit', 'celsius']).optional().describe('Temperature units'),
})
```

#### 3. `outputSchema` (Zod schema, optional)

Define the expected output structure of your tool using Zod schemas. This helps the AI understand what data your tool will return and validates the output.

```javascript
outputSchema: z.object({
  temperature: z.number().describe('The temperature value'),
  condition: z.string().describe('Weather condition description'),
  humidity: z.number().optional().describe('Humidity percentage'),
})
```

#### 4. `execute` (async function)

The function that performs the tool's action. Receives validated parameters and returns the result.

```javascript
execute: async ({ location, units = 'fahrenheit' }) => {
  // Your implementation
  const data = await fetchWeatherData(location);
  return {
    temperature: data.temp,
    condition: data.condition,
  };
}
```

### Accessing Environment Variables

Tools can receive environment variables passed via `--env` by exporting a function instead of an object:

```javascript
import { z } from 'zod';

export default (env) => ({
  description: 'Search the web for information',
  inputSchema: z.object({
    query: z.string().describe('The search query'),
  }),
  execute: async ({ query }) => {
    const apiKey = env.BRAVE_SEARCH_API_KEY;

    if (!apiKey) {
      throw new Error('BRAVE_SEARCH_API_KEY is required');
    }

    // Use the API key
    const response = await fetch(`https://api.example.com?key=${apiKey}`);
    return response.json();
  },
});
```

### Tool File Naming

- Tool files must end with `.js`
- The filename (without `.js`) becomes the tool name
- Example: `getWeather.js` → tool name: `getWeather`
- Use camelCase for tool names

## Example Tools

### Simple Tool (No Environment Variables)

```javascript
// tools/calculateDistance.js
import { z } from 'zod';

export default {
  description: 'Calculate distance length measurement between two geographic locations cities places points coordinates. Compute travel distance mileage kilometers miles route path between origin destination. Get straight-line direct distance as-the-crow-flies air distance great-circle distance. Find distance from one city to another location to location point-to-point geographical spacing separation.',
  inputSchema: z.object({
    from: z.string().describe('Starting location or city'),
    to: z.string().describe('Destination location or city'),
  }),
  outputSchema: z.object({
    distance: z.number().describe('The distance value'),
    unit: z.string().describe('The unit of measurement (e.g., miles, kilometers)'),
    from: z.string().describe('Starting location'),
    to: z.string().describe('Destination location'),
  }),
  execute: async ({ from, to }) => {
    // Implementation here
    return {
      distance: 1234,
      unit: 'miles',
      from,
      to,
    };
  },
};
```

### Tool with Environment Variables

```javascript
// tools/sendEmail.js
import { z } from 'zod';

export default (env) => ({
  description: 'Send electronic mail email message letter correspondence communication to recipient address. Email messaging write compose send deliver transmit dispatch email messages notifications alerts reminders updates newsletters. Contact reach-out communicate via email electronic mail internet mail SMTP messaging service.',
  inputSchema: z.object({
    to: z.string().describe('Recipient email address'),
    subject: z.string().describe('Email subject line'),
    body: z.string().describe('Email body content'),
  }),
  outputSchema: z.object({
    success: z.boolean().describe('Whether the email was sent successfully'),
    messageId: z.string().describe('The unique message identifier'),
  }),
  execute: async ({ to, subject, body }) => {
    const apiKey = env.SENDGRID_API_KEY;

    if (!apiKey) {
      throw new Error('SENDGRID_API_KEY environment variable is required');
    }

    // Send email using API key
    // ...

    return { success: true, messageId: '123' };
  },
});
```

## How It Works

1. **Tool Discovery**: The agent uses AI to discover relevant tools based on user prompts by matching against tool descriptions
2. **Tool Execution**: When the AI determines which tools to use, it generates code to call them with appropriate parameters
3. **Conversational Context**: The agent maintains conversation history within a session, allowing for follow-up questions
4. **Safety**: Tool execution code is validated to prevent dangerous operations

## Interactive Usage

Once you run `together-agent run ./tools`, you'll enter an interactive prompt where you can:

- Ask questions that use your tools
- Have multi-turn conversations (context is preserved)
- Type `exit` to quit
- Press Ctrl+C to stop the server

Example session:

```
Enter your prompt: What's the weather in San Francisco?

Response:
──────────────────────────────────────────────────
The current weather in San Francisco is 62°F and partly cloudy.
──────────────────────────────────────────────────

Enter your prompt (or 'exit' to quit): How about New York?

Response:
──────────────────────────────────────────────────
The weather in New York is currently 45°F with clear skies.
──────────────────────────────────────────────────

Enter your prompt (or 'exit' to quit): exit
```

## Best Practices

### Tool Descriptions
- Be extremely verbose - the AI uses this to discover tools
- Include synonyms and related terms
- Think about different ways users might ask for the same thing
- Don't worry about length - descriptions aren't sent as API payload

### Input Schemas
- Use descriptive names for parameters
- Always include `.describe()` on each field
- Use Zod's validation features (enums, optional, etc.)

### Execute Functions
- Always use async/await for consistency
- Handle errors gracefully with clear error messages
- Return structured data that's easy to interpret
- Validate environment variables at the start

### Error Handling
```javascript
execute: async (params) => {
  try {
    // Your logic
  } catch (error) {
    throw new Error(`Failed to fetch data: ${error.message}`);
  }
}
```

## Troubleshooting

### "TOGETHER_API_KEY environment variable is required"
Make sure you've set your Together AI API key:
```bash
export TOGETHER_API_KEY="your-key"
```

Or pass it directly when using the SDK:
```typescript
const sdk = new TogetherAgentSDK({ apiKey: 'your-key' });
```

### "Tools directory not found"
Verify the path to your tools directory is correct and that it exists:
```bash
ls ./tools  # Should show your .js tool files
```

### Tool not being discovered
Enhance your tool's description with more keywords and synonyms related to what the tool does. Remember, descriptions should be verbose and keyword-rich.

### Environment variable not available in tool
**CLI:** Make sure you're passing it via `--env`:
```bash
together-agent run ./tools --env MY_VAR=value
```

**SDK:** Pass it in the prompt options:
```typescript
await agent.prompt('Your prompt', {
  env: { MY_VAR: 'value' }
});
```

### Deployment fails
- Ensure your tools directory contains valid JavaScript files
- Make sure all dependencies in `tools/package.json` are correct
- Verify your TOGETHER_API_KEY is valid

### Agent creation fails or times out
CodeSandbox may take a moment to spin up the sandbox. The `createAgent` call waits for the sandbox to be created. If it times out, the sandbox may need more time to start, or there may be an issue with the deployment.

## License

MIT
