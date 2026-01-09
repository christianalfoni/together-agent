#!/usr/bin/env node

import * as readline from "readline";
import { TogetherAgentSDK } from "together-agent";
import { config as dotenvConfig } from "dotenv";

// Load environment variables
dotenvConfig();

const TOGETHER_API_KEY = process.env.TOGETHER_API_KEY;
const AGENT_TEMPLATE_ID = process.env.AGENT_TEMPLATE_ID;

if (!TOGETHER_API_KEY || !AGENT_TEMPLATE_ID) {
  console.error("Error: Missing required environment variables");
  console.error("Please set TOGETHER_API_KEY and AGENT_TEMPLATE_ID in your .env file");
  process.exit(1);
}

// ============================================================================
// Main Demo - SDK Usage
// ============================================================================

console.log("\nTOGETHER AGENT DEMO");
console.log("Initializing agent from template...\n");

// Initialize the Together Agent SDK
const sdk = new TogetherAgentSDK({ apiKey: TOGETHER_API_KEY });

// Create an agent instance from the template
const agent = await sdk.createAgent(AGENT_TEMPLATE_ID);

console.log("✅ Agent created successfully!");
console.log("Sandbox ID: " + agent.sandboxId);
console.log("Agent URL: " + agent.url + "\n");

// Start the interactive prompt loop
await startInteractiveLoop(agent);

// ============================================================================
// Interactive Loop
// ============================================================================

async function startInteractiveLoop(agent) {
  while (true) {
    const userPrompt = await askQuestion("\nEnter your prompt (or 'exit' to quit): ");

    if (!userPrompt.trim()) {
      console.error("Error: Prompt cannot be empty");
      continue;
    }

    if (userPrompt.toLowerCase() === "exit") {
      console.log("\nExiting...");
      process.exit(0);
    }

    console.log("\nSending prompt to agent...\n");

    try {
      // Send prompt using the SDK
      const response = await agent.prompt(userPrompt, { secrets: {} });

      // Process the streaming response
      await processSSEStream(response, agent);
    } catch (error) {
      console.error("Failed to send request:", error.message);
      process.exit(1);
    }
  }
}

// ============================================================================
// Helper Functions - Readline & SSE Processing
// ============================================================================

function askQuestion(prompt) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function processSSEStream(response, agent) {
  if (!response.body) {
    throw new Error("Server returned no body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let hasError = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        try {
          const message = JSON.parse(data);

          // Handle approval requests
          if (message.type === "approval_request") {
            await handleApproval(message, agent);
            continue;
          }

          // Display other messages
          displayMessage(message);

          if (message.type === "error") {
            hasError = true;
          }
        } catch (e) {
          console.error("Failed to parse SSE message:", data);
        }
      }
    }
  }

  if (hasError) {
    process.exit(1);
  }
}

async function handleApproval(message, agent) {
  console.log("\n[DEMO] 🔐 APPROVAL REQUIRED");
  console.log("Payload:");
  const payloadLines = JSON.stringify(message.payload, null, 2).split("\n");
  payloadLines.forEach((line) => console.log(line));

  const answer = await askQuestion("Approve? (yes/no): ");
  const approved = answer.toLowerCase() === "yes";

  try {
    // Use SDK methods for approval
    if (approved) {
      await agent.approve(message.approvalId);
      console.log("✅ Approved");
    } else {
      await agent.reject(message.approvalId);
      console.log("❌ Rejected");
    }
  } catch (error) {
    console.error("Failed to send approval response:", error.message);
  }
}

function displayMessage(message) {
  switch (message.type) {
    case "tool_discovery_completed":
      console.log("\n[DEMO] 🔍 TOOL DISCOVERY");
      console.log(`Query: ${message.query}`);
      if (message.matchedTools.length > 0) {
        console.log(`Matched tools: ${message.matchedTools.join(", ")}`);
      } else {
        console.log("No tools matched");
      }
      break;

    case "tool_execution_started":
      console.log("\n[DEMO] ⚙️  TOOL EXECUTION");
      message.code.split("\n").forEach((line) => console.log(line));
      break;

    case "tool_execution_completed":
      if (message.error) {
        console.log("\n[DEMO] ⚙️  TOOL EXECUTION - ERROR");
        console.log("Error:", message.error);
      } else if (message.logs && message.logs.length > 0) {
        console.log("\n[DEMO] ⚙️  TOOL EXECUTION - LOGS");
        message.logs.forEach((log) => console.log(log));
      }
      break;

    case "code_execution_started":
      console.log("\n[DEMO] 💻 CODE EXECUTION");
      message.code.split("\n").forEach((line) => console.log(line));
      break;

    case "code_execution_completed":
      if (message.error) {
        console.log("\n[DEMO] 💻 CODE EXECUTION - ERROR");
        console.log("Error:", message.error);
      } else if (message.logs && message.logs.length > 0) {
        console.log("\n[DEMO] 💻 CODE EXECUTION - LOGS");
        message.logs.forEach((log) => console.log(log));
      }
      break;

    case "custom_tool_call_started":
      const startedTitle = `[DEMO] ▶️  ${message.toolName.toUpperCase()} - STARTED`;
      console.log("\n" + startedTitle);
      if (message.args) {
        const argsLines = JSON.stringify(message.args, null, 2).split("\n");
        argsLines.forEach((line) => console.log(line));
      }
      break;

    case "custom_tool_call_completed":
      if (message.error) {
        const errorTitle = `[DEMO] ❌ ${message.toolName.toUpperCase()} - ERROR`;
        console.log("\n" + errorTitle);
        console.log("Error:", message.error);
      } else {
        const completedTitle = `[DEMO] ✅ ${message.toolName.toUpperCase()} - COMPLETED`;
        console.log("\n" + completedTitle);
        if (message.result !== undefined) {
          console.log("Result:");
          const resultStr =
            typeof message.result === "object"
              ? JSON.stringify(message.result, null, 2)
              : String(message.result);
          resultStr.split("\n").forEach((line) => console.log(line));
        }
      }
      break;

    case "text":
      if (message.content) {
        console.log("\n[DEMO] 💬 RESPONSE");
        message.content.split("\n").forEach((line) => console.log(line));
      }
      break;

    case "error":
      console.log("\n[DEMO] ❌ ERROR");
      console.log(message.error);
      break;

    case "done":
      // Silent - just marks completion
      break;
  }
}
