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

        console.log(`Loaded tool: ${toolName}`);
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

    // Filter out tool-related messages and only keep user/assistant text messages
    // We only want to store the final text response, not intermediate tool calls
    const assistantMessage: CoreMessage = {
      role: "assistant",
      content: result.text,
    };

    // Create a clean message history without tool calls/results
    const cleanMessages = [...messages, assistantMessage];

    // Store only the clean conversation history
    sessions.set(sessionId, cleanMessages);

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
