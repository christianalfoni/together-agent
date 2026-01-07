import { Router } from "express";
import { createTogetherAI } from "@ai-sdk/togetherai";
import { streamText, stepCountIs, tool, CoreMessage } from "ai";
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

export const router = Router();

// Agent instance conversation state
let messages: CoreMessage[] = [];

async function loadTools(context: ToolExecutionContext) {
  const toolsPath = process.env.TOOLS_PATH;

  if (!toolsPath) {
    console.warn("No TOOLS_PATH specified, running without tools");
    return {};
  }

  const tools: Record<string, any> = {};

  try {
    const files = fs.readdirSync(toolsPath);
    const jsFiles = files.filter((file) => file.endsWith(".js"));

    for (const file of jsFiles) {
      const toolPath = path.join(toolsPath, file);
      const toolName = path.basename(file, ".js");

      try {
        // Use dynamic import with file:// URL for ESM compatibility
        const toolModule = await import(pathToFileURL(toolPath).href);
        const toolDef =
          typeof toolModule.default === "function"
            ? toolModule.default(context)
            : toolModule.default;

        if (
          !toolDef ||
          !toolDef.description ||
          !toolDef.inputSchema ||
          !toolDef.execute
        ) {
          console.warn(
            `Skipping ${file}: missing required fields (description, inputSchema, execute)`
          );
          continue;
        }

        // Store tool definition (will be wrapped later)
        tools[toolName] = toolDef;
      } catch (err) {
        console.error(`Failed to load tool ${file}:`, err);
      }
    }
  } catch (err) {
    console.error("Failed to load tools:", err);
  }

  return tools;
}

function wrapCustomToolWithMessages(
  toolName: string,
  toolDef: any,
  sendMessage: (message: AgentMessage) => void,
  context: ToolExecutionContext
) {
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
        const result = await toolDef.execute(params, context);

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

function wrapNativeToolsWithMessages(
  tools: Record<string, any>,
  sendMessage: (message: AgentMessage) => void
) {
  return {
    discover_tools: {
      ...tools.discover_tools,
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
    },
    execute_tools: {
      ...tools.execute_tools,
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
    },
    execute_code: {
      ...tools.execute_code,
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
    },
  };
}

router.post("/approval", (req, res) => {
  try {
    const response: ApprovalResponse = req.body;

    if (!response.approvalId) {
      return res.status(400).json({ error: "approvalId is required" });
    }

    if (typeof response.approved !== "boolean") {
      return res.status(400).json({ error: "approved must be a boolean" });
    }

    const resolved = resolveApproval(response);

    if (!resolved) {
      return res.status(404).json({
        error: "Approval request not found or already resolved",
      });
    }

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

    // Send approval request message immediately (bypass queue)
    sendMessageNow({
      type: "approval_request",
      approvalId,
      payload,
    });

    // Wait for approval response (throws if rejected or timed out)
    await createApprovalRequest(approvalId, timeout);
  };

  // Create context object for tools
  const context: ToolExecutionContext = {
    secrets: secrets,
    requestApproval,
  };

  try {
    // Add user message to conversation history
    const userMessage: CoreMessage = {
      role: "user",
      content: prompt,
    };
    messages.push(userMessage);

    const together = createTogetherAI({ apiKey });
    const customTools = await loadTools(context);

    // Wrap custom tools to send started/completed messages, then convert to AI SDK format
    const wrappedCustomTools: Record<string, any> = {};
    for (const [toolName, toolDef] of Object.entries(customTools)) {
      const wrappedTool = wrapCustomToolWithMessages(
        toolName,
        toolDef,
        queueMessage,
        context
      );
      // Convert to AI SDK tool format AFTER wrapping for messages
      wrappedCustomTools[toolName] = tool(wrappedTool);
    }

    // Create code tools (native tools)
    const codeTools = createCodeTools(wrappedCustomTools);

    // Wrap native tools to send completion messages
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
