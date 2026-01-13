import { Router } from "express";
import { createTogetherAI } from "@ai-sdk/togetherai";
import { streamText, stepCountIs, tool as aiSDKTool, CoreMessage } from "ai";
import { createCapabilities } from "./tools";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import {
  AgentMessage,
  ToolExecutionContext,
  ApprovalResponse,
  SessionState,
  JournalConfig,
} from "./types";
import {
  generateApprovalId,
  createApprovalRequest,
  resolveApproval,
} from "./approval";
import { CustomCapabilityDefinition } from "../index";
import { workspacePath, customAgentPrompt } from "./index";
import { shouldCompress, performCompression } from "./journal";
import {
  createReadJournalEntriesTool,
  createAddJournalEntryTool,
} from "./tools/journal_tools";

export const router = Router();

// Agent instance conversation state - will be replaced with per-request SessionState
// Kept for backward compatibility with existing code paths
let sessionState: SessionState = {
  messages: [],
  journalEntries: [],
  messageToJournals: new Map(),
  lastUserOrAssistantMessage: null,
  lastPromptTokens: 0,
  cumulativeInputTokens: 0,
  cumulativeOutputTokens: 0,
  discoveredTools: new Map(),
  executionContext: {},
  customPrompt: undefined, // Will be set at request time from customAgentPrompt
};

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

  // Create index.js with capability function (no TypeScript types)
  const indexJs = `// Temporary shim for together-agent until package is published
export function capability(capabilityDefinition) {
  return (context) => {
    return {
      discoveryTerms: capabilityDefinition.discoveryTerms,
      inputSchema: capabilityDefinition.inputSchema,
      outputSchema: capabilityDefinition.outputSchema,
      execute: (input) => capabilityDefinition.execute(input, context),
    };
  };
}

// Alias for backward compatibility
export const tool = capability;
`;

  fs.writeFileSync(path.join(togetherAgentPath, "index.js"), indexJs);
}

async function loadTools(
  context: ToolExecutionContext
): Promise<Record<string, CustomCapabilityDefinition>> {
  const toolsPath = process.env.TOOLS_PATH;

  if (!toolsPath) {
    console.warn("No TOOLS_PATH specified, running without capabilities");
    return {};
  }

  // Ensure together-agent shim exists before loading capabilities
  ensureTogetherAgentShim(toolsPath);

  const capabilities: Record<string, CustomCapabilityDefinition> = {};

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
            capabilities[fileName] = toolDef;
          } else {
            console.warn(
              `Skipping default export in ${file}: missing required fields (discoveryTerms, inputSchema, outputSchema, execute)`
            );
          }
        }

        // Process named exports (use export name as capability name)
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
            capabilities[exportName] = toolDef;
          } else {
            console.warn(
              `Skipping named export '${exportName}' in ${file}: missing required fields (discoveryTerms, inputSchema, outputSchema, execute)`
            );
          }
        }
      } catch (err) {
        console.error(`Failed to load capability ${file}:`, err);
      }
    }
  } catch (err) {
    console.error("Failed to load capabilities:", err);
  }

  return capabilities;
}

function wrapCustomToolWithMessages(
  toolName: string,
  toolDef: CustomCapabilityDefinition,
  sendMessage: (message: AgentMessage) => void
): CustomCapabilityDefinition {
  return {
    ...toolDef,
    execute: async (params: any) => {
      // Generate a unique call ID for this execution
      const callId = `${toolName}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`;

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
        const errorMessage =
          error instanceof Error ? error.message : String(error);

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
 * Wraps LLM tools with message sending and converts them to AI SDK tool format
 */
function wrapNativeToolsWithMessages(
  capabilities: Record<string, any>,
  wrappedCapabilities: Record<string, any>,
  sendMessage: (message: AgentMessage) => void,
  state: SessionState
) {
  return {
    discover_capabilities: aiSDKTool({
      description: capabilities.discover_capabilities.description,
      inputSchema: capabilities.discover_capabilities.inputSchema as any,
      execute: async (params: { terms: string }) => {
        const result = await capabilities.discover_capabilities.execute(params);

        // Extract capability names and discovery terms for the message
        const allMatchedTools =
          result.tools?.map((t: any) => ({
            name: t.name,
            discoveryTerms: t.discoveryTerms || [],
          })) || [];

        // Store discovered capabilities in session state
        // These will be included in the system prompt on the next turn, making them
        // permanently visible to the LLM without needing to re-discover them.
        // This is more efficient than re-discovering and ensures the LLM always knows
        // what capabilities are available and what data structures they return (outputSchema).
        for (const tool of result.tools || []) {
          if (!state.discoveredTools.has(tool.name)) {
            state.discoveredTools.set(tool.name, {
              name: tool.name,
              inputSchema: tool.inputSchema,
              outputSchema: tool.outputSchema,
            });
          }
        }

        // Send discovery completion message
        sendMessage({
          type: "discover_capabilities",
          terms: params.terms,
          matchedTools: allMatchedTools,
        });

        // IMPORTANT: Convert to JSON string to avoid AI SDK validation issues
        // The AI SDK stores tool results in message history, and complex nested objects
        // with schemas cause validation failures. By stringifying, we ensure clean serialization.
        // Return all matched capabilities (no deduplication - rely on context compression instead)
        return JSON.stringify({ tools: result.tools || [] }, null, 2);
      },
    }),
    execute_code: aiSDKTool({
      description: capabilities.execute_code.description,
      inputSchema: capabilities.execute_code.inputSchema as any,
      execute: async (params: { code: string }) => {
        // Generate unique execution ID
        const executionId = `${Date.now()}-${Math.random()
          .toString(36)
          .substring(2, 9)}`;

        // Send started message with code BEFORE execution
        sendMessage({
          type: "code_execution_started",
          code: params.code,
          executionId,
        });

        // Call the original execute_code capability which has appendJournalEntry
        const result = await capabilities.execute_code.execute(params);

        // Parse the JSON result to check for errors
        let parsedResult;
        let errorMessage;
        try {
          parsedResult = JSON.parse(result);
          errorMessage = parsedResult.error;
        } catch (e) {
          // If parsing fails, treat the whole result as an error
          errorMessage = "Failed to parse execute_code result";
        }

        // Send completion message with result/error AFTER execution
        sendMessage({
          type: "code_execution_completed",
          result: result,
          error: errorMessage,
          executionId,
        });

        return result;
      },
    }),
  };
}

/**
 * Generates the system prompt with discovered capabilities included
 *
 * DESIGN DECISION: Why System Prompt Instead of Formal Tools Array?
 *
 * Problem: The LLM struggles to "remember" dynamically discovered capabilities when they only
 * exist in conversation history. In long conversations or with context compression,
 * the LLM may forget about available capabilities.
 *
 * Why not use the formal Claude API tools array for capabilities?
 * - The formal tools array only supports: name, description, input_schema
 * - Our capabilities ALSO have outputSchema, which is critical for the LLM to know what data
 *   structure it will receive when calling capabilities via execute_code
 * - The LLM needs outputSchema to compose correct code that handles capability results
 *
 * Why system prompt?
 * - Keeps full capability definitions (including outputSchema) always visible to the LLM
 * - Discovery happens mostly at conversation start (user comes in with a goal)
 * - System prompt updates are cheap since they happen at the start of each turn
 * - The LLM can reference capability schemas without re-discovering them
 * - Works well with prompt caching after initial discovery
 *
 * Note: "Tools" (discover_capabilities, execute_code) are what the LLM calls directly.
 * "Capabilities" are what the LLM can use inside execute_code via the capabilities global.
 */
function generateSystemPrompt(
  discoveredTools: Map<string, any>,
  customBasePrompt?: string
): string {
  const basePrompt = `${
    customBasePrompt ||
    "You are a helpful AI assistant. You are friendly and focused on the user goals."
  }

## Your Primary Capability: Code Execution

**You solve tasks by executing code with access to specialized capabilities.**

For EVERY user request, follow this workflow:
1. **Discover**: Use discover_capabilities to find relevant capabilities for the task
2. **Execute**: Find the optimal composition of capabilities discovered using their output schema to write efficient
code for execute_code
3. **Respond**: Format the results naturally for the user

**CRITICAL: NEVER say you can't do something without first discovering capabilities**
- Before declining a request, use discover_capabilities with relevant terms
- Only if NO relevant capabilities are found should you explain you cannot help
- Examples of discovery terms: "email", "weather", "file", "database", "api", "pdf", etc.

## Tool Usage Guidelines

**IMPORTANT - Internal Tool Mechanics:**
- NEVER mention tool names (discover_capabilities, execute_code, etc.) in your responses to users
- NEVER say "I'm calling the X tool" or "Let me use the Y tool"
- NEVER explain that you're discovering or executing capabilities
- Tool usage is INTERNAL BEHAVIOR - users should only see natural responses
- Just perform actions and present results naturally without exposing implementation details

## execute_code Guidelines

**Sandboxed Execution**
- import and require is not available or allowed
- use the global "capabilities" to execute discovered capabilities
- You can only use "capabilities" with capabilities that have been discovered with discover_capabilities

**Capability Execution Patterns**

Example 1: Chaining capabilities using output schemas
\`\`\`javascript
// User asks: "What's the weather in my current city?"
// Capabilities discovered: getUserLocation, getWeather

const location = await capabilities.getUserLocation();
// Output schema tells us location returns { city: string, country: string }

const weather = await capabilities.getWeather({
  city: location.city
});

await addJournalEntry("Weather Query", \`
Location: \${location.city}, \${location.country}
Weather: \${weather.temperature}°C, \${weather.condition}
\`);

return { city: location.city, weather: weather.condition };
\`\`\`

Example 2: Parallel execution for independent operations
\`\`\`javascript
// User asks: "Get me data from all three databases"
// Capabilities discovered: queryUserDB, queryAnalyticsDB, queryInventoryDB

const [users, analytics, inventory] = await Promise.all([
  capabilities.queryUserDB({ table: "active_users" }),
  capabilities.queryAnalyticsDB({ metric: "daily_visits" }),
  capabilities.queryInventoryDB({ status: "in_stock" })
]);

await addJournalEntry("Database Report", \`
Users: \${users.count} active
Analytics: \${analytics.visits} daily visits
Inventory: \${inventory.items.length} items in stock
\`);

return { users, analytics, inventory };
\`\`\`

Example 3: Complex nested workflow with deduplication
\`\`\`javascript
// User asks: "Get all posts with their comments and comment authors"
// Capabilities discovered: getPosts, getComments, getUser

const posts = await capabilities.getPosts({ limit: 10 });
// Output schema: { posts: Array<{ id: string, title: string }> }

// Fetch comments for all posts in parallel
const commentsPerPost = await Promise.all(
  posts.posts.map(post =>
    capabilities.getComments({ postId: post.id })
  )
);
// Output schema: { comments: Array<{ id: string, userId: string, text: string }> }

// Collect unique user IDs to avoid duplicate fetches
const userIds = new Set();
commentsPerPost.forEach(result => {
  result.comments.forEach(comment => {
    userIds.add(comment.userId);
  });
});

// Fetch all unique users in parallel
const userPromises = Array.from(userIds).map(userId =>
  capabilities.getUser({ userId })
);
const users = await Promise.all(userPromises);
// Output schema: { id: string, name: string, email: string }

// Build user lookup map
const userMap = {};
users.forEach(user => {
  userMap[user.id] = user;
});

await addJournalEntry("Posts Analysis", \`
Fetched \${posts.posts.length} posts
Total comments: \${commentsPerPost.reduce((sum, r) => sum + r.comments.length, 0)}
Unique users: \${userIds.size}
\`);

return {
  posts: posts.posts,
  comments: commentsPerPost,
  users: userMap
};
\`\`\`

**Key Principles:**
- Output schemas show you exactly what data structure each tool returns
- Use this knowledge to write complete workflows in one execute_code
- Use Promise.all for independent operations
- Always populate journal entries with meaningful data from tool results
- Only split into multiple execute_code calls when you need to see actual results to decide next steps
`;

  // Add discovered capabilities section
  let toolsSection = "\n## Discovered Capabilities (for use in execute_code)\n\n";

  if (discoveredTools.size === 0) {
    toolsSection +=
      "No capabilities have been discovered yet. Use discover_capabilities to find capabilities available for execute_code.\n";
  } else {
    toolsSection +=
      "The following capabilities have been discovered and are available for use in execute_code via capabilities:\n\n";

    for (const [name, tool] of discoveredTools.entries()) {
      toolsSection += `### ${name}\n\n`;
      toolsSection += `**Input Schema:**\n\`\`\`json\n${JSON.stringify(
        tool.inputSchema,
        null,
        2
      )}\n\`\`\`\n\n`;
      toolsSection += `**Output Schema:**\n\`\`\`json\n${JSON.stringify(
        tool.outputSchema,
        null,
        2
      )}\n\`\`\`\n\n`;
    }
  }

  return basePrompt + toolsSection;
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

router.get("/files/*filepath", (req, res) => {
  try {
    // Extract the file path from the URL (everything after /files/)
    // filepath is an array when using wildcard routes
    const requestedPath = Array.isArray(req.params.filepath)
      ? req.params.filepath.join("/")
      : req.params.filepath;

    if (!requestedPath) {
      return res.status(400).json({ error: "File path is required" });
    }

    // Build the full file path
    const filePath = path.join(workspacePath, requestedPath);

    // Security: Prevent path traversal attacks
    const normalizedPath = path.normalize(filePath);
    if (!normalizedPath.startsWith(workspacePath)) {
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

router.put("/files/*filepath", (req, res) => {
  try {
    // Extract the file path from the URL (everything after /files/)
    // filepath is an array when using wildcard routes
    const requestedPath = Array.isArray(req.params.filepath)
      ? req.params.filepath.join("/")
      : req.params.filepath;

    if (!requestedPath) {
      return res.status(400).json({ error: "File path is required" });
    }

    // Build the full file path
    const filePath = path.join(workspacePath, requestedPath);

    // Security: Prevent path traversal attacks
    const normalizedPath = path.normalize(filePath);
    if (!normalizedPath.startsWith(workspacePath)) {
      return res.status(403).json({ error: "Access denied" });
    }

    // Create subdirectories if they don't exist
    const dirPath = path.dirname(normalizedPath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    // Collect the file data from the request body
    const chunks: Buffer[] = [];

    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        const fileContent = Buffer.concat(chunks);

        // Write the file (overwriting if it exists)
        fs.writeFileSync(normalizedPath, fileContent);

        // Get file stats for response
        const stat = fs.statSync(normalizedPath);

        // Return success response with file info
        res.json({
          success: true,
          path: requestedPath,
          size: stat.size,
          message: "File uploaded successfully",
        });
      } catch (error) {
        console.error("Error writing file:", error);
        res.status(500).json({
          error: "Failed to write file",
        });
      }
    });

    req.on("error", (error) => {
      console.error("Error receiving file data:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error receiving file data" });
      }
    });
  } catch (error) {
    console.error("Error in upload endpoint:", error);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Internal server error",
      });
    }
  }
});

router.post("/", async (req, res) => {
  const {
    prompt,
    apiKey,
    secrets = {},
    approvalTimeout = 30000,
    journalConfig,
  } = req.body;

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

  // Parse journal configuration
  const config: JournalConfig = {
    contextSizeThreshold: journalConfig?.contextSizeThreshold ?? 50000,
  };

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
    workspacePath,
  };

  try {
    // Set custom prompt at request time (not module load time) to avoid initialization order issues
    if (sessionState.messages.length === 0) {
      sessionState.customPrompt = customAgentPrompt;
    }

    // Update or add system message with current discovered tools
    // We regenerate the system prompt on EVERY turn to include any newly discovered tools.
    // This ensures the LLM always has access to the full set of discovered tools with their
    // complete schemas (including outputSchema, which the formal tools array doesn't support).
    // Since tool discovery happens mostly at conversation start, this is efficient and avoids
    // the need for the LLM to re-discover tools it has already found.
    const systemPromptContent = generateSystemPrompt(
      sessionState.discoveredTools,
      sessionState.customPrompt
    );

    if (sessionState.messages.length === 0) {
      // First message - add system message
      const systemMessage: CoreMessage = {
        role: "system",
        content: systemPromptContent,
      };
      sessionState.messages.push(systemMessage);
    } else {
      // Update existing system message with current discovered tools
      if (sessionState.messages[0]?.role === "system") {
        sessionState.messages[0].content = systemPromptContent;
      }
    }

    // Add user message to conversation history
    const userMessage: CoreMessage = {
      role: "user",
      content: prompt,
    };
    sessionState.messages.push(userMessage);
    // Track this as the last user/assistant message for journal attachment
    sessionState.lastUserOrAssistantMessage = userMessage;

    const together = createTogetherAI({ apiKey });
    const capabilities = await loadTools(context);

    // Wrap capabilities to send started/completed messages
    const wrappedCapabilities: Record<string, CustomCapabilityDefinition> = {};
    for (const [capabilityName, capabilityDef] of Object.entries(capabilities)) {
      wrappedCapabilities[capabilityName] = wrapCustomToolWithMessages(
        capabilityName,
        capabilityDef,
        queueMessage
      );
    }

    // Create journal tools
    const readJournalEntriesTool = createReadJournalEntriesTool(
      workspacePath,
      queueMessage
    );
    const addJournalEntry = createAddJournalEntryTool(
      sessionState,
      config,
      workspacePath,
      queueMessage
    );

    // Create capabilities (native tools) with wrapped capabilities and addJournalEntry
    const nativeCapabilities = createCapabilities(
      wrappedCapabilities,
      addJournalEntry,
      () => sessionState.executionContext,
      (newContext) => {
        sessionState.executionContext = newContext;
      },
      () => new Set(sessionState.discoveredTools.keys())
    );

    // Wrap tools to send completion messages and convert to AI SDK format
    const wrappedTools = {
      ...wrapNativeToolsWithMessages(
        nativeCapabilities,
        wrappedCapabilities,
        queueMessage,
        sessionState
      ),
      read_journal_entries: aiSDKTool({
        description: readJournalEntriesTool.description,
        inputSchema: readJournalEntriesTool.inputSchema as any,
        execute: readJournalEntriesTool.execute,
      }),
    };

    // Filter out discover_capabilities and execute_code requests (keep only results)
    const filterInternalToolCalls = (
      messages: CoreMessage[]
    ): CoreMessage[] => {
      return messages.map((message) => {
        // Only filter assistant messages with content arrays
        if (
          message.role !== "assistant" ||
          typeof message.content === "string"
        ) {
          return message;
        }

        if (!Array.isArray(message.content)) {
          return message;
        }

        // Filter out tool-call content for discover_capabilities and execute_code
        const filteredContent = message.content.filter((part: any) => {
          if (part.type === "tool-call") {
            const toolName = part.toolName;
            // Filter out internal tool calls
            return (
              toolName !== "discover_capabilities" &&
              toolName !== "execute_code"
            );
          }
          // Keep all other content (text, tool-result, etc.)
          return true;
        });

        // Return message with filtered content
        return {
          ...message,
          content: filteredContent,
        };
      });
    };

    // Filter messages before sending to LLM
    const filteredMessages = filterInternalToolCalls(sessionState.messages);

    // Validate and clean messages
    const cleanedMessages = filteredMessages.map((msg: any) => {
      // Ensure content is never undefined
      if (msg.content === undefined || msg.content === null) {
        return { ...msg, content: "" };
      }
      return msg;
    });

    // Capture the messages we're sending to the model (before they get updated with the response)
    const messagesBeingsent = JSON.parse(JSON.stringify(cleanedMessages)); // deep clone

    const result = streamText({
      // model: together("moonshotai/Kimi-K2-Thinking"),
      model: together("moonshotai/Kimi-K2-Instruct-0905"),
      messages: cleanedMessages, // CoreMessages are already in the right format
      tools: wrappedTools,
      stopWhen: stepCountIs(40),
      temperature: 0.1,
    });

    // Use fullStream to get events in the correct order for CLIENT streaming
    // We'll use finalMessages for the conversation history
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

    // Get the final response and usage
    const finalResponse = await result.response;
    const finalMessages = finalResponse.messages;

    // Get usage from result.usage (not finalResponse.usage)
    const usage = await result.usage;

    // Get step count (number of turns used in this request)
    const stepCount = (finalResponse as any).stepCount || 0;

    // Track token usage for compression and cumulative stats
    const currentInputTokens = usage?.inputTokens || 0;
    const currentOutputTokens = usage?.outputTokens || 0;

    // Update cumulative totals (for cost tracking)
    sessionState.cumulativeInputTokens += currentInputTokens;
    sessionState.cumulativeOutputTokens += currentOutputTokens;

    // Update last prompt tokens for compression check
    sessionState.lastPromptTokens = currentInputTokens;

    // finalMessages contains ONLY the NEW messages from this turn (not the full conversation)
    // So we can just append them all directly to sessionState.messages
    if (finalMessages.length > 0) {
      for (const msg of finalMessages) {
        sessionState.messages.push(msg);

        // Track assistant messages for journal attachment
        if (msg.role === "assistant") {
          sessionState.lastUserOrAssistantMessage = msg;
        }
      }
    } else {
      // No new messages - add placeholder to prevent consecutive user messages
      const placeholderMessage: CoreMessage = {
        role: "assistant",
        content:
          "I encountered an issue processing your request. Please try again.",
      };
      sessionState.messages.push(placeholderMessage);
      sessionState.lastUserOrAssistantMessage = placeholderMessage;

      sendMessageNow({
        type: "error",
        error: "Request completed without a response",
      });
    }

    // Check if compression is needed and perform it
    // Only compress if context threshold is exceeded
    if (shouldCompress(sessionState, config)) {
      performCompression(sessionState, config, queueMessage);
      flushQueue(); // Flush compression messages
    }

    // Send debug message showing what was sent to the LLM on this turn (INPUT)
    sendMessageNow({
      type: "debug",
      messages: messagesBeingsent.map((msg) => ({
        role: msg.role,
        content:
          typeof msg.content === "string"
            ? msg.content.slice(0, 200) +
              (msg.content.length > 200 ? "..." : "")
            : Array.isArray(msg.content)
            ? msg.content.map((c: any) => {
                if (c.type === "text") {
                  return `[text: ${c.text?.slice(0, 100)}...]`;
                } else if (c.type === "tool-call") {
                  return `[tool-call: ${c.toolName}]`;
                } else if (c.type === "tool-result") {
                  // Show actual tool result data, not just the ID
                  // AI SDK stores results in output.value
                  const actualResult = c.output?.value ?? c.result;
                  const resultPreview =
                    actualResult === undefined
                      ? "undefined"
                      : typeof actualResult === "string"
                      ? actualResult.slice(0, 100)
                      : JSON.stringify(actualResult)?.slice(0, 100) || "null";
                  return `[tool-result: ${c.toolCallId} | result: ${resultPreview}...]`;
                }
                return `[${c.type}]`;
              })
            : msg.content,
      })),
      messageCount: messagesBeingsent.length,
    });

    // Send done message with token usage and turn info
    sendMessageNow({
      type: "done",
      contextSize: currentInputTokens, // Current conversation size (will decrease after compression)
      cumulativeInput: sessionState.cumulativeInputTokens, // Total input tokens (always increases)
      cumulativeOutput: sessionState.cumulativeOutputTokens, // Total output tokens (always increases)
      turns: stepCount,
      totalTurns: 40,
    });

    res.end();
  } catch (error) {
    console.error("Error occurred:", error);
    sendMessageNow({
      type: "error",
      error: error instanceof Error ? error.message : "An error occurred",
    });
    res.end();
  }
});
