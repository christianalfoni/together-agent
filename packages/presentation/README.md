# Together Agent Presentation Demo

A simple Node.js application demonstrating the Together Agent SDK by creating and interacting with an agent.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in your values:
   ```bash
   cp .env.example .env
   ```

3. Set the required environment variables in `.env`:
   - `TOGETHER_API_KEY`: Your Together API key
   - `AGENT_TEMPLATE_ID`: The template ID from your agent deployment

## Usage

Run the demo:
```bash
npm start
```

Or directly:
```bash
node demo.js
```

The application will:
1. Initialize the Together Agent SDK
2. Create a new agent instance from your template
3. Start an interactive prompt where you can:
   - Enter prompts to send to your agent
   - See real-time updates about tool executions, code executions, and responses
   - Approve or reject approval requests from tools
   - Type 'exit' to quit

## How It Works

The demo application:
1. Imports and initializes the `TogetherAgentSDK`
2. Creates an agent instance using `sdk.createAgent(templateId)`
3. Sends prompts to the agent using authenticated URLs
4. Processes the Server-Sent Events (SSE) stream response
5. Displays various events with a distinctive `[DEMO]` prefix including:
   - Tool discoveries
   - Tool executions
   - Code executions
   - Custom tool calls
   - Agent responses
   - Approval requests

## Workflow for Presentations

1. Deploy your agent using the Together Agent CLI:
   ```bash
   together-agent deploy path/to/your/tools
   ```

2. Note the **template ID** from the deployment output

3. Set the environment variables in your `.env` file:
   ```
   TOGETHER_API_KEY=your_api_key
   AGENT_TEMPLATE_ID=<template_id_from_deployment>
   ```

4. Run the demo:
   ```bash
   npm start
   ```

5. The SDK will create a new agent instance from your template and you can interact with it!

## Visual Style

The demo uses a distinctive box-drawing visual style with `[DEMO]` prefixes to make it easy to distinguish from the `together-agent run` command during presentations.
