import { Router } from "express";
import { createTogetherAI } from "@ai-sdk/togetherai";
import { generateText, stepCountIs, tool, CoreMessage } from "ai";
import { createCodeTools } from "./tools";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { randomUUID } from "crypto";

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

function printBaseToolsUsage() {
  console.log("\n" + "=".repeat(70));
  console.log("BASE TOOLS AVAILABLE");
  console.log("=".repeat(70));

  console.log("\n1. discover_tools");
  console.log("   Description: Discover available tools by searching tool names");
  console.log("   and schemas with a query pattern");
  console.log("   Parameters:");
  console.log("   - query (string): The search query to find relevant tools");
  console.log("   Example usage:");
  console.log("   discover_tools({ query: 'weather' })");

  console.log("\n2. execute_tools");
  console.log("   Description: Execute JavaScript code with access to tools via");
  console.log("   the 'tools' object. Return the result you want access to.");
  console.log("   Parameters:");
  console.log("   - code (string): The JavaScript code to execute");
  console.log("   Example usage:");
  console.log("   execute_tools({ code: 'return await tools.getWeather({ location: \"NYC\" })' })");

  console.log("\n3. execute_code");
  console.log("   Description: Execute arbitrary JavaScript code for calculations,");
  console.log("   data transformations, or complex logic");
  console.log("   Parameters:");
  console.log("   - code (string): The JavaScript code to execute");
  console.log("   Example usage:");
  console.log("   execute_code({ code: 'return [1,2,3].map(x => x * 2)' })");

  console.log("\n" + "=".repeat(70) + "\n");
}

router.post("/", async (req, res) => {
  const { prompt, apiKey, env = {}, sessionId: providedSessionId, debug = false } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: "Prompt is required" });
  }

  if (!apiKey) {
    return res.status(400).json({ error: "Together API key is required" });
  }

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

    const result = await generateText({
      model: together("moonshotai/Kimi-K2-Instruct-0905"),
      messages,
      tools: createCodeTools(tools),
      stopWhen: stepCountIs(20),
    });

    // Filter out only discover_tools calls to reduce token usage
    // Keep all other tool calls so the LLM has context about what it executed
    // result.response.messages includes all messages (input + new responses)
    const filteredMessages = result.response.messages
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

    // Store the conversation history with tool calls (except discover_tools)
    sessions.set(sessionId, filteredMessages);

    res.json({
      success: true,
      sessionId,
      response: result.text,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "An error occurred",
    });
  }
});
