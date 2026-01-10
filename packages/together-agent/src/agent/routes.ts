import { Router } from "express";
import { createTogetherAI } from "@ai-sdk/togetherai";
import { streamText, stepCountIs, tool as aiSDKTool, CoreMessage } from "ai";
import { createCodeTools } from "./tools";
import { executeTools } from "./tools/execute_tools";
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
import { workspacePath } from "./index";

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
      outputSchema: toolDefinition.outputSchema,
      execute: (input) => toolDefinition.execute(input, context),
    };
  };
}
`;

  fs.writeFileSync(path.join(togetherAgentPath, "index.js"), indexJs);
}

async function loadTools(
  context: ToolExecutionContext
): Promise<Record<string, CustomToolDefinition>> {
  const toolsPath = process.env.TOOLS_PATH;

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
            toolDef.outputSchema &&
            toolDef.execute
          ) {
            tools[fileName] = toolDef;
          } else {
            console.warn(
              `Skipping default export in ${file}: missing required fields (discoveryTerms, inputSchema, outputSchema, execute)`
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
            toolDef.outputSchema &&
            toolDef.execute
          ) {
            tools[exportName] = toolDef;
          } else {
            console.warn(
              `Skipping named export '${exportName}' in ${file}: missing required fields (discoveryTerms, inputSchema, outputSchema, execute)`
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
  wrappedCustomTools: Record<string, any>,
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
          type: "discover_tools",
          query: params.query,
          matchedTools,
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

        // Get raw execution result for message
        const execution = await executeTools(params.code, wrappedCustomTools);

        // Send completion message with result/error AFTER execution
        sendMessage({
          type: "code_execution_completed",
          result: execution.result,
          error: execution.error,
        });

        // Format result for AI SDK (convert error to markdown if needed)
        if (execution.error) {
          return `## Error\n\n${execution.error}`;
        }
        return execution.result || "";
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

router.get("/files/*filepath", (req, res) => {
  try {
    // Extract the file path from the URL (everything after /files/)
    // filepath is an array when using wildcard routes
    const requestedPath = Array.isArray(req.params.filepath)
      ? req.params.filepath.join('/')
      : req.params.filepath;

    if (!requestedPath) {
      return res.status(400).json({ error: "File path is required" });
    }

    // Build the full file path
    const filePath = path.join(workspacePath, requestedPath);

    // Security: Prevent path traversal attacks
    const normalizedPath = path.normalize(filePath);
    if (!normalizedPath.startsWith(workspacePath)) {
      console.log("🚫 SERVER: Path traversal attempt blocked:", requestedPath);
      return res.status(403).json({ error: "Access denied" });
    }

    // Check if file exists
    if (!fs.existsSync(normalizedPath)) {
      return res.status(404).json({ error: "File not found" });
    }

    // Check if it's a file (not a directory)
    const stat = fs.statSync(normalizedPath);
    if (!stat.isFile()) {
      return res.status(400).json({ error: "Path is not a file" });
    }

    // Determine MIME type based on file extension
    const ext = path.extname(normalizedPath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".pdf": "application/pdf",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
      ".json": "application/json",
      ".txt": "text/plain",
      ".csv": "text/csv",
      ".html": "text/html",
      ".css": "text/css",
      ".js": "application/javascript",
      ".xml": "application/xml",
      ".zip": "application/zip",
    };
    const mimeType = mimeTypes[ext] || "application/octet-stream";

    // Set response headers
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Length", stat.size);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${path.basename(normalizedPath)}"`
    );

    // Stream the file
    const fileStream = fs.createReadStream(normalizedPath);
    fileStream.pipe(res);

    fileStream.on("error", (error) => {
      console.error("Error streaming file:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error reading file" });
      }
    });

  } catch (error) {
    console.error("Error in files endpoint:", error);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Internal server error",
      });
    }
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
    workspacePath,
  };

  try {
    // Add system message if this is the first message in the conversation
    if (messages.length === 0) {
      const systemMessage: CoreMessage = {
        role: "system",
        content: `You are a helpful AI assistant with access to various tools to help users accomplish their tasks.

CRITICAL: ALWAYS TRY TO DISCOVER TOOLS FIRST
- When a user asks you to do something, your FIRST instinct should be to discover if there are tools available
- Think broadly about what tools might exist: if the user mentions emails, files, data, APIs, documents, etc., there are likely tools for those
- Don't try to answer or explain limitations - instead, discover tools and use them to accomplish the task
- Custom tools are powerful and give you capabilities beyond general knowledge - USE THEM!

TOOL USAGE INSTRUCTIONS:
- You have TWO native tools available: discover_tools and execute_code
- discover_tools: Use this DIRECTLY to find available custom tools based on a query
  - Use broad search terms (e.g., "email", "file", "data", "document", "api")
  - Search terms should match the domain of the user's request
- execute_code: Use this for both:
  1) Calling custom tools you've discovered (like readEmails, sendEmail, etc.)
  2) General JavaScript computation, calculations, data manipulation, etc.
  - ALWAYS use 'await' when calling tools (e.g., 'await tools.sendEmail(...)')
  - Tools are asynchronous and need await to complete properly
  - This is especially important for tools that require user approval

IMPORTANT: NEVER try to call discover_tools from within execute_code. These are separate tools you call directly.

CORRECT TOOL USAGE:
✅ Call discover_tools directly when you need to find tools
✅ Then call execute_code with: await tools.toolName(...) for tool calls
✅ Call execute_code with: Math.pow(2, 10) for calculations
❌ NEVER write code like: await tools.discover_tools() inside execute_code
❌ NEVER try to discover tools from within code execution
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
    const wrappedNativeTools = wrapNativeToolsWithMessages(codeTools, wrappedCustomTools, queueMessage);

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
