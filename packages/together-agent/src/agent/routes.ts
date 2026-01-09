import { Router } from "express";
import { createTogetherAI } from "@ai-sdk/togetherai";
import { streamText, stepCountIs, tool as aiSDKTool, CoreMessage } from "ai";
import { createCodeTools } from "./tools";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { AgentMessage, ToolExecutionContext, ApprovalResponse } from "./types";
import {
  generateApprovalId,
  createApprovalRequest,
  resolveApproval,
} from "./approval";
import { CustomToolDefinition } from "../index";

export const router = Router();

// Agent instance conversation state
let messages: CoreMessage[] = [];

/**
 * Creates a minimal together-agent shim package in node_modules if it doesn't exist.
 * This is a temporary hack until the package is published to npm.
 */
function ensureTogetherAgentShim(toolsPath: string): void {
  const nodeModulesPath = path.join(toolsPath, "node_modules");
  const togetherAgentPath = path.join(nodeModulesPath, "together-agent");

  // Check if together-agent already exists
  if (fs.existsSync(togetherAgentPath)) {
    return;
  }

  console.log("[SHIM] Creating together-agent shim package...");

  // Create directories
  fs.mkdirSync(togetherAgentPath, { recursive: true });

  // Create package.json
  const packageJson = {
    name: "together-agent",
    version: "0.1.0",
    main: "index.js",
    type: "module",
  };

  fs.writeFileSync(
    path.join(togetherAgentPath, "package.json"),
    JSON.stringify(packageJson, null, 2)
  );

  // Create index.js with tool function (no TypeScript types)
  const indexJs = `// Temporary shim for together-agent until package is published
export function tool(toolDefinition) {
  return (context) => {
    return {
      discoveryTerms: toolDefinition.discoveryTerms,
      inputSchema: toolDefinition.inputSchema,
      execute: (input) => toolDefinition.execute(input, context),
    };
  };
}
`;

  fs.writeFileSync(path.join(togetherAgentPath, "index.js"), indexJs);

  console.log("[SHIM] ✓ together-agent shim created at:", togetherAgentPath);
}

async function loadTools(
  context: ToolExecutionContext
): Promise<Record<string, CustomToolDefinition>> {
  const toolsPath = process.env.TOOLS_PATH;

  console.log("[DEBUG] loadTools called");
  console.log("[DEBUG] TOOLS_PATH:", toolsPath);
  console.log("[DEBUG] process.env keys:", Object.keys(process.env).join(", "));

  if (!toolsPath) {
    console.warn("No TOOLS_PATH specified, running without tools");
    return {};
  }

  // Ensure together-agent shim exists before loading tools
  ensureTogetherAgentShim(toolsPath);

  const tools: Record<string, CustomToolDefinition> = {};

  try {
    const files = fs.readdirSync(toolsPath);
    const jsFiles = files.filter((file) => file.endsWith(".js"));

    for (const file of jsFiles) {
      const toolPath = path.join(toolsPath, file);
      const fileName = path.basename(file, ".js");

      try {
        // Use dynamic import with file:// URL for ESM compatibility
        const toolModule = await import(pathToFileURL(toolPath).href);

        // Process default export (use filename as tool name)
        if (toolModule.default) {
          let toolDef =
            typeof toolModule.default === "function"
              ? toolModule.default(context)
              : toolModule.default;

          if (
            toolDef &&
            toolDef.discoveryTerms &&
            toolDef.inputSchema &&
            toolDef.execute
          ) {
            tools[fileName] = toolDef;
          } else {
            console.warn(
              `Skipping default export in ${file}: missing required fields (discoveryTerms, inputSchema, execute)`
            );
          }
        }

        // Process named exports (use export name as tool name)
        for (const [exportName, exportValue] of Object.entries(toolModule)) {
          if (exportName === "default") continue;

          let toolDef =
            typeof exportValue === "function"
              ? exportValue(context)
              : exportValue;

          if (
            toolDef &&
            toolDef.discoveryTerms &&
            toolDef.inputSchema &&
            toolDef.execute
          ) {
            tools[exportName] = toolDef;
          } else {
            console.warn(
              `Skipping named export '${exportName}' in ${file}: missing required fields (discoveryTerms, inputSchema, execute)`
            );
          }
        }
      } catch (err) {
        console.error(`Failed to load tool ${file}:`, err);
      }
    }
  } catch (err) {
    console.error("Failed to load tools:", err);
  }

  console.log("[DEBUG] Loaded tools:", Object.keys(tools));
  console.log("[DEBUG] Tool count:", Object.keys(tools).length);

  return tools;
}

function wrapCustomToolWithMessages(
  toolName: string,
  toolDef: CustomToolDefinition,
  sendMessage: (message: AgentMessage) => void
): CustomToolDefinition {
  return {
    ...toolDef,
    execute: async (params: any) => {
      // Generate a unique call ID for this execution
      const callId = `${toolName}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Send custom tool started message
      sendMessage({
        type: "custom_tool_call_started",
        toolName,
        args: params,
        callId,
      });

      try {
        const result = await toolDef.execute(params);

        // Send custom tool completed message
        sendMessage({
          type: "custom_tool_call_completed",
          toolName,
          callId,
          result,
        });

        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Send custom tool completed message with error
        sendMessage({
          type: "custom_tool_call_completed",
          toolName,
          callId,
          error: errorMessage,
        });

        // Re-throw the error so AI SDK can handle it
        throw error;
      }
    },
  };
}

/**
 * Wraps native tools with message sending and converts them to AI SDK tool format
 */
function wrapNativeToolsWithMessages(
  tools: Record<string, any>,
  sendMessage: (message: AgentMessage) => void
) {
  return {
    discover_tools: aiSDKTool({
      description: tools.discover_tools.description,
      inputSchema: tools.discover_tools.inputSchema as any,
      execute: async (params: { query: string }) => {
        const result = await tools.discover_tools.execute(params);

        // Extract tool names from the result
        const matchedTools = result.tools?.map((t: any) => t.name) || [];

        // Send discovery completion message
        sendMessage({
          type: "tool_discovery_completed",
          query: params.query,
          matchedTools,
        });

        return result;
      },
    }),
    execute_tools: aiSDKTool({
      description: tools.execute_tools.description,
      inputSchema: tools.execute_tools.inputSchema as any,
      execute: async (params: { code: string }) => {
        // Send started message with code BEFORE execution
        sendMessage({
          type: "tool_execution_started",
          code: params.code,
        });

        const result = await tools.execute_tools.execute(params);

        // Send completion message with logs AFTER execution
        sendMessage({
          type: "tool_execution_completed",
          logs: result.logs,
          error: result.error,
        });

        return result;
      },
    }),
    execute_code: aiSDKTool({
      description: tools.execute_code.description,
      inputSchema: tools.execute_code.inputSchema as any,
      execute: async (params: { code: string }) => {
        // Send started message with code BEFORE execution
        sendMessage({
          type: "code_execution_started",
          code: params.code,
        });

        const result = await tools.execute_code.execute(params);

        // Send completion message with logs AFTER execution
        sendMessage({
          type: "code_execution_completed",
          logs: result.logs,
          error: result.error,
        });

        return result;
      },
    }),
  };
}

router.post("/approval", (req, res) => {
  try {
    const response: ApprovalResponse = req.body;

    console.log("📨 SERVER: Received approval response", response);

    if (!response.approvalId) {
      return res.status(400).json({ error: "approvalId is required" });
    }

    if (typeof response.approved !== "boolean") {
      return res.status(400).json({ error: "approved must be a boolean" });
    }

    const resolved = resolveApproval(response);

    if (!resolved) {
      console.log("❌ SERVER: Approval request not found or already resolved");
      return res.status(404).json({
        error: "Approval request not found or already resolved",
      });
    }

    console.log("✅ SERVER: Approval resolved successfully");
    res.json({ success: true });
  } catch (error) {
    console.error("Error in approval endpoint:", error);
    res.status(500).json({
      error: "Internal server error handling approval",
    });
  }
});

router.post("/", async (req, res) => {
  const { prompt, apiKey, secrets = {}, approvalTimeout = 30000 } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: "Prompt is required" });
  }

  if (!apiKey) {
    return res.status(400).json({ error: "Together API key is required" });
  }

  if (typeof approvalTimeout !== "number" || approvalTimeout <= 0) {
    return res.status(400).json({
      error: "approvalTimeout must be a positive number",
    });
  }

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Message queue to ensure correct ordering
  const messageQueue: AgentMessage[] = [];

  // Helper function to queue messages (used by tool wrappers)
  const queueMessage = (message: AgentMessage) => {
    messageQueue.push(message);
  };

  // Helper function to send a message immediately (bypass queue)
  const sendMessageNow = (message: AgentMessage) => {
    res.write(`data: ${JSON.stringify(message)}\n\n`);
  };

  // Helper function to flush the queue
  const flushQueue = () => {
    for (const message of messageQueue) {
      sendMessageNow(message);
    }
    messageQueue.length = 0;
  };

  // Create requestApproval function for tools
  const requestApproval = async (
    payload: any,
    timeoutMs?: number
  ): Promise<void> => {
    const approvalId = generateApprovalId();
    const timeout = timeoutMs || approvalTimeout;

    console.log("🚨 SERVER: Creating approval request", approvalId, payload);

    // Send approval request message immediately (bypass queue)
    sendMessageNow({
      type: "approval_request",
      approvalId,
      payload,
    });

    console.log("🚨 SERVER: Waiting for approval response...");
    // Wait for approval response (throws if rejected or timed out)
    await createApprovalRequest(approvalId, timeout);
    console.log("✅ SERVER: Approval received, continuing execution");
  };

  // Create context object for tools
  const context: ToolExecutionContext = {
    secrets: secrets,
    requestApproval,
  };

  try {
    // Add system message if this is the first message in the conversation
    if (messages.length === 0) {
      const systemMessage: CoreMessage = {
        role: "system",
        content: `You are a helpful AI assistant with access to various tools to help users accomplish their tasks.

CRITICAL TOOL USAGE INSTRUCTIONS:
- You have THREE native tools available: discover_tools, execute_tools, and execute_code
- discover_tools: Use this DIRECTLY to find available custom tools based on a query
- execute_tools: Use this to call custom tools you've discovered (like readEmails, sendEmail, etc.)
  - ALWAYS use 'await' when calling tools (e.g., 'await tools.sendEmail(...)')
  - Tools are asynchronous and need await to complete properly
  - This is especially important for tools that require user approval
- execute_code: Use this for general JavaScript computation

IMPORTANT: NEVER try to call discover_tools from within execute_tools or execute_code. These are separate tools you call directly.

CORRECT TOOL USAGE:
✅ Call discover_tools directly when you need to find tools
✅ Then call execute_tools with: await tools.toolName(...)
❌ NEVER write code like: await tools.discover_tools() inside execute_tools
❌ NEVER try to discover tools from within tool execution code
❌ NEVER forget 'await' when calling tools

USER COMMUNICATION:
- NEVER mention or expose the internal tool discovery mechanism to users
- NEVER say things like "Let me discover a tool" or "I'll search for available tools"
- Instead, be natural and direct about what you're going to do

EXAMPLES:
❌ "Let me see if I can discover a tool to help with that"
✅ "Let me help you with that"

❌ "Great! I found a readEmails tool. Let me use it now."
✅ "Let me check your emails for you"

Be confident, natural, and focus on the user's intent rather than the technical process.`,
      };
      messages.push(systemMessage);
    }

    // Add user message to conversation history
    const userMessage: CoreMessage = {
      role: "user",
      content: prompt,
    };
    messages.push(userMessage);

    const together = createTogetherAI({ apiKey });
    const customTools = await loadTools(context);

    // Wrap custom tools to send started/completed messages
    const wrappedCustomTools: Record<string, CustomToolDefinition> = {};
    for (const [toolName, toolDef] of Object.entries(customTools)) {
      wrappedCustomTools[toolName] = wrapCustomToolWithMessages(
        toolName,
        toolDef,
        queueMessage
      );
    }

    // Create code tools (native tools) with wrapped custom tools
    const codeTools = createCodeTools(wrappedCustomTools);

    // Wrap native tools to send completion messages and convert to AI SDK format
    const wrappedNativeTools = wrapNativeToolsWithMessages(codeTools, queueMessage);

    const result = streamText({
      model: together("moonshotai/Kimi-K2-Instruct-0905"),
      messages,
      tools: wrappedNativeTools,
      stopWhen: stepCountIs(20),
    });

    // Use fullStream to get events in the correct order
    for await (const chunk of result.fullStream) {
      switch (chunk.type) {
        case "text-delta":
          // Add text to queue immediately, or update existing text message
          const text = (chunk as any).text;
          if (text) {
            // Check if the last message in queue is a text message
            const lastMessage = messageQueue[messageQueue.length - 1];
            if (lastMessage && lastMessage.type === "text") {
              // Update existing text message in place
              (lastMessage as any).content += text;
            } else {
              // Create new text message at the front of the queue
              messageQueue.push({
                type: "text",
                content: text,
              });
            }
          }
          break;

        case "tool-call":
          // Don't need to do anything - text is already in queue if there is any
          break;

        case "tool-result":
          // Flush the queue - text message will be first, then tool messages
          flushQueue();
          break;

        case "finish":
          // Flush any remaining messages
          flushQueue();
          break;
      }
    }

    // Get the final messages from the result
    const finalMessages = await result.response.then((r) => r.messages);

    // Filter out only discover_tools calls to reduce token usage
    const filteredMessages = finalMessages
      .map((msg) => {
        // Keep all user messages as-is
        if (msg.role === "user") {
          return msg;
        }

        // For assistant messages, filter out discover_tools calls from content
        if (msg.role === "assistant") {
          const content = Array.isArray(msg.content) ? msg.content : [msg.content];
          const filteredContent = content.filter(
            (c: any) => !(c.type === "tool-call" && c.toolName === "discover_tools")
          );

          // Only keep the message if it has remaining content
          if (filteredContent.length > 0) {
            return { ...msg, content: filteredContent };
          }
          return null;
        }

        // For tool result messages, filter out discover_tools results
        if (msg.role === "tool") {
          const content = Array.isArray(msg.content) ? msg.content : [msg.content];
          const filteredContent = content.filter(
            (c: any) => !(c.type === "tool-result" && c.toolName === "discover_tools")
          );

          // Only keep the message if it has remaining content
          if (filteredContent.length > 0) {
            return { ...msg, content: filteredContent };
          }
          return null;
        }

        return msg;
      })
      .filter((msg): msg is CoreMessage => msg !== null);

    // Store the conversation history
    messages = filteredMessages;

    // Send done message
    sendMessageNow({
      type: "done",
    });

    res.end();
  } catch (error) {
    sendMessageNow({
      type: "error",
      error: error instanceof Error ? error.message : "An error occurred",
    });
    res.end();
  }
});
