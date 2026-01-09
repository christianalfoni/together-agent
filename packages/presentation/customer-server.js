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

console.log("\n╔" + "═".repeat(68) + "╗");
console.log("║" + " ".repeat(20) + "TOGETHER AGENT DEMO" + " ".repeat(28) + "║");
console.log("╠" + "═".repeat(68) + "╣");
console.log("║ Initializing agent from template...");
console.log("╚" + "═".repeat(68) + "╝\n");

// Initialize the Together Agent SDK
const sdk = new TogetherAgentSDK({ apiKey: TOGETHER_API_KEY });

// Create an agent instance from the template
const agent = await sdk.createAgent(AGENT_TEMPLATE_ID);

console.log("╔" + "═".repeat(68) + "╗");
console.log("║ ✅ Agent created successfully!");
console.log("║ Sandbox ID: " + agent.sandboxId);
console.log("║ Agent URL: " + agent.url);
console.log("╚" + "═".repeat(68) + "╝\n");

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
  console.log("\n╔" + "═".repeat(68) + "╗");
  console.log("║ [DEMO] 🔐 APPROVAL REQUIRED" + " ".repeat(39) + "║");
  console.log("╠" + "═".repeat(68) + "╣");
  console.log("║ Payload:");
  const payloadLines = JSON.stringify(message.payload, null, 2).split("\n");
  payloadLines.forEach((line) => console.log("║ " + line));
  console.log("╚" + "═".repeat(68) + "╝");

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
      console.log("\n╔" + "═".repeat(68) + "╗");
      console.log("║ [DEMO] 🔍 TOOL DISCOVERY" + " ".repeat(42) + "║");
      console.log("╠" + "═".repeat(68) + "╣");
      console.log(`║ Query: ${message.query}`);
      if (message.matchedTools.length > 0) {
        console.log(`║ Matched tools: ${message.matchedTools.join(", ")}`);
      } else {
        console.log("║ No tools matched");
      }
      console.log("╚" + "═".repeat(68) + "╝");
      break;

    case "tool_execution_started":
      console.log("\n╔" + "═".repeat(68) + "╗");
      console.log("║ [DEMO] ⚙️  TOOL EXECUTION" + " ".repeat(40) + "║");
      console.log("╠" + "═".repeat(68) + "╣");
      message.code.split("\n").forEach((line) => console.log("║ " + line));
      console.log("╚" + "═".repeat(68) + "╝");
      break;

    case "tool_execution_completed":
      if (message.error) {
        console.log("\n╔" + "═".repeat(68) + "╗");
        console.log("║ [DEMO] ⚙️  TOOL EXECUTION - ERROR" + " ".repeat(32) + "║");
        console.log("╠" + "═".repeat(68) + "╣");
        console.log("║ Error:", message.error);
        console.log("╚" + "═".repeat(68) + "╝");
      } else if (message.logs && message.logs.length > 0) {
        console.log("\n╔" + "═".repeat(68) + "╗");
        console.log("║ [DEMO] ⚙️  TOOL EXECUTION - LOGS" + " ".repeat(33) + "║");
        console.log("╠" + "═".repeat(68) + "╣");
        message.logs.forEach((log) => console.log("║ " + log));
        console.log("╚" + "═".repeat(68) + "╝");
      }
      break;

    case "code_execution_started":
      console.log("\n╔" + "═".repeat(68) + "╗");
      console.log("║ [DEMO] 💻 CODE EXECUTION" + " ".repeat(42) + "║");
      console.log("╠" + "═".repeat(68) + "╣");
      message.code.split("\n").forEach((line) => console.log("║ " + line));
      console.log("╚" + "═".repeat(68) + "╝");
      break;

    case "code_execution_completed":
      if (message.error) {
        console.log("\n╔" + "═".repeat(68) + "╗");
        console.log("║ [DEMO] 💻 CODE EXECUTION - ERROR" + " ".repeat(34) + "║");
        console.log("╠" + "═".repeat(68) + "╣");
        console.log("║ Error:", message.error);
        console.log("╚" + "═".repeat(68) + "╝");
      } else if (message.logs && message.logs.length > 0) {
        console.log("\n╔" + "═".repeat(68) + "╗");
        console.log("║ [DEMO] 💻 CODE EXECUTION - LOGS" + " ".repeat(35) + "║");
        console.log("╠" + "═".repeat(68) + "╣");
        message.logs.forEach((log) => console.log("║ " + log));
        console.log("╚" + "═".repeat(68) + "╝");
      }
      break;

    case "custom_tool_call_started":
      console.log("\n╔" + "═".repeat(68) + "╗");
      const startedTitle = `[DEMO] ▶️  ${message.toolName.toUpperCase()} - STARTED`;
      console.log("║ " + startedTitle + " ".repeat(68 - startedTitle.length - 1) + "║");
      console.log("╠" + "═".repeat(68) + "╣");
      if (message.args) {
        const argsLines = JSON.stringify(message.args, null, 2).split("\n");
        argsLines.forEach((line) => console.log("║ " + line));
      }
      console.log("╚" + "═".repeat(68) + "╝");
      break;

    case "custom_tool_call_completed":
      console.log("\n╔" + "═".repeat(68) + "╗");
      if (message.error) {
        const errorTitle = `[DEMO] ❌ ${message.toolName.toUpperCase()} - ERROR`;
        console.log("║ " + errorTitle + " ".repeat(68 - errorTitle.length - 1) + "║");
        console.log("╠" + "═".repeat(68) + "╣");
        console.log("║ Error:", message.error);
      } else {
        const completedTitle = `[DEMO] ✅ ${message.toolName.toUpperCase()} - COMPLETED`;
        console.log("║ " + completedTitle + " ".repeat(68 - completedTitle.length - 1) + "║");
        console.log("╠" + "═".repeat(68) + "╣");
        if (message.result !== undefined) {
          console.log("║ Result:");
          const resultStr =
            typeof message.result === "object"
              ? JSON.stringify(message.result, null, 2)
              : String(message.result);
          resultStr.split("\n").forEach((line) => console.log("║ " + line));
        }
      }
      console.log("╚" + "═".repeat(68) + "╝");
      break;

    case "text":
      if (message.content) {
        console.log("\n╔" + "═".repeat(68) + "╗");
        console.log("║ [DEMO] 💬 RESPONSE" + " ".repeat(48) + "║");
        console.log("╠" + "═".repeat(68) + "╣");
        message.content.split("\n").forEach((line) => console.log("║ " + line));
        console.log("╚" + "═".repeat(68) + "╝");
      }
      break;

    case "error":
      console.log("\n╔" + "═".repeat(68) + "╗");
      console.log("║ [DEMO] ❌ ERROR" + " ".repeat(51) + "║");
      console.log("╠" + "═".repeat(68) + "╣");
      console.log("║ " + message.error);
      console.log("╚" + "═".repeat(68) + "╝");
      break;

    case "done":
      // Silent - just marks completion
      break;
  }
}
