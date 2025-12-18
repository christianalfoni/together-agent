import { Router } from "express";
import { createTogetherAI } from "@ai-sdk/togetherai";
import { streamText, stepCountIs, tool, CoreMessage } from "ai";
import { createCodeTools } from "./tools";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { randomUUID } from "crypto";
import { AgentMessage } from "./types";

export const router = Router();

// In-memory session storage
const sessions = new Map<string, CoreMessage[]>();

async function loadTools(env: Record<string, string>) {
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
            ? toolModule.default(env)
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

        // Convert to AI SDK tool format
        tools[toolName] = tool(toolDef);
      } catch (err) {
        console.error(`Failed to load tool ${file}:`, err);
      }
    }
  } catch (err) {
    console.error("Failed to load tools:", err);
  }

  return tools;
}

router.post("/", async (req, res) => {
  const { prompt, apiKey, env = {}, sessionId: providedSessionId } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: "Prompt is required" });
  }

  if (!apiKey) {
    return res.status(400).json({ error: "Together API key is required" });
  }

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Helper function to send SSE message
  const sendMessage = (message: AgentMessage) => {
    res.write(`data: ${JSON.stringify(message)}\n\n`);
  };

  try {
    // Generate or use existing sessionId
    const sessionId = providedSessionId || randomUUID();

    // Get or initialize session messages
    let messages: CoreMessage[] = sessions.get(sessionId) || [];

    // Add user message to conversation history
    const userMessage: CoreMessage = {
      role: "user",
      content: prompt,
    };
    messages.push(userMessage);

    const together = createTogetherAI({ apiKey });
    const tools = await loadTools(env);

    const result = streamText({
      model: together("moonshotai/Kimi-K2-Instruct-0905"),
      messages,
      tools: createCodeTools(tools),
      stopWhen: stepCountIs(20),
    });

    // Buffer text deltas and flush when we hit tool calls
    let textBuffer = "";

    const flushText = () => {
      if (textBuffer) {
        sendMessage({
          type: "text",
          content: textBuffer,
        });
        textBuffer = "";
      }
    };

    // Use fullStream to get events in the correct order
    for await (const chunk of result.fullStream) {
      switch (chunk.type) {
        case "text-delta":
          // Accumulate text deltas
          const text = (chunk as any).text;
          if (text) {
            textBuffer += text;
          }
          break;

        case "tool-call":
          // Flush any accumulated text before the tool call
          flushText();

          // Send tool call when it's requested
          sendMessage({
            type: "tool_call_requested",
            toolName: chunk.toolName,
            args: (chunk as any).input,
            callId: chunk.toolCallId,
          });
          break;

        case "tool-result":
          // Flush any accumulated text after the tool result
          flushText();

          // Only send completion message if there's an error
          if ((chunk as any).error || chunk.result?.error) {
            sendMessage({
              type: "tool_call_completed",
              toolName: chunk.toolName,
              callId: chunk.toolCallId,
              result: chunk.result,
              error: (chunk as any).error || chunk.result?.error,
            });
          }
          break;

        case "finish":
          // Flush any remaining text at the end
          flushText();
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
    sessions.set(sessionId, filteredMessages);

    // Send done message
    sendMessage({
      type: "done",
      sessionId,
    });

    res.end();
  } catch (error) {
    sendMessage({
      type: "error",
      error: error instanceof Error ? error.message : "An error occurred",
    });
    res.end();
  }
});
