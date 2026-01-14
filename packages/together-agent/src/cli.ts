#!/usr/bin/env node

import { Command } from "commander";
import { version } from "../package.json";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync, spawn } from "child_process";
import * as readline from "readline";
import { config as dotenvConfig } from "dotenv";

const program = new Command();

// Helper function to build an agent from tools directory
interface BuildAgentOptions {
  verbose?: boolean;
}

function buildAgent(
  toolsPath: string,
  outputPath: string = "dist",
  options: BuildAgentOptions = {}
): string {
  const absoluteToolsPath = path.resolve(toolsPath);
  const absoluteOutputPath = path.isAbsolute(outputPath)
    ? outputPath
    : path.join(absoluteToolsPath, outputPath);

  // Check if the tools directory exists
  if (!fs.existsSync(absoluteToolsPath)) {
    throw new Error(`Tools directory not found: ${absoluteToolsPath}`);
  }

  if (!fs.statSync(absoluteToolsPath).isDirectory()) {
    throw new Error(`Tools path is not a directory: ${absoluteToolsPath}`);
  }

  // Check if tsconfig.json exists
  const hasTsConfig = fs.existsSync(
    path.join(absoluteToolsPath, "tsconfig.json")
  );

  if (!hasTsConfig) {
    throw new Error(
      `No tsconfig.json found at ${absoluteToolsPath}. Please initialize the project with 'together-agent init' first.`
    );
  }

  if (options.verbose) {
    console.log("Compiling TypeScript tools...");
  }

  try {
    // Compile with custom outDir
    execSync(`npx tsc --outDir "${absoluteOutputPath}"`, {
      cwd: absoluteToolsPath,
      stdio: options.verbose ? "inherit" : "pipe",
    });

    if (!fs.existsSync(absoluteOutputPath)) {
      throw new Error(
        `Compilation succeeded but output folder not found at ${absoluteOutputPath}`
      );
    }

    // Copy AGENT.md if it exists in the source folder
    const sourceAgentMd = path.join(absoluteToolsPath, "AGENT.md");
    if (fs.existsSync(sourceAgentMd)) {
      const destAgentMd = path.join(absoluteOutputPath, "AGENT.md");
      fs.copyFileSync(sourceAgentMd, destAgentMd);
      if (options.verbose) {
        console.log("✓ Copied AGENT.md to output folder");
      }
    }

    if (options.verbose) {
      console.log("✓ Tools compiled successfully");
    }

    return absoluteOutputPath;
  } catch (error) {
    throw new Error("Failed to compile TypeScript tools");
  }
}

program
  .name("together-agent")
  .description("A TypeScript CLI SDK")
  .version(version);

program
  .command("hello")
  .description("Say hello")
  .argument("[name]", "name to greet", "World")
  .action((name: string) => {
    console.log(`Hello, ${name}!`);
  });

program
  .command("init")
  .description("Initialize a new agent project")
  .argument("<path>", "path to create the project")
  .action((projectPath: string) => {
    const absolutePath = path.resolve(projectPath);

    console.log(`Creating project at: ${absolutePath}`);

    // Create the folder
    fs.mkdirSync(absolutePath, { recursive: true });

    // Create package.json
    const packageJson = {
      name: path.basename(absolutePath),
      version: "1.0.0",
      type: "module",
      scripts: {
        build: "tsc",
      },
      dependencies: {
        zod: "latest",
      },
      devDependencies: {
        typescript: "latest",
        "@types/node": "latest",
      },
    };

    fs.writeFileSync(
      path.join(absolutePath, "package.json"),
      JSON.stringify(packageJson, null, 2)
    );

    // Create tsconfig.json
    const tsconfigContent = {
      compilerOptions: {
        target: "ES2020",
        module: "ESNext",
        lib: ["ES2020"],
        outDir: "./dist",
        rootDir: "./",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        resolveJsonModule: true,
        moduleResolution: "bundler",
      },
      include: ["*.ts"],
      exclude: ["node_modules", "dist"],
    };

    fs.writeFileSync(
      path.join(absolutePath, "tsconfig.json"),
      JSON.stringify(tsconfigContent, null, 2)
    );

    // Create getWeather.ts
    const getWeatherContent = `import { z } from 'zod'
import { tool } from 'together-agent'

export default tool({
  discoveryTerms: ['weather', 'temperature', 'climate', 'forecast', 'conditions'],
  inputSchema: z.object({
    location: z.string().describe('The city name'),
    units: z.enum(['fahrenheit', 'celsius']).default('fahrenheit').describe('Temperature units'),
  }),
  outputSchema: z.object({
    location: z.string().describe('The city name'),
    temperature: z.number().describe('Current temperature'),
    units: z.enum(['fahrenheit', 'celsius']).describe('Temperature units'),
    condition: z.string().describe('Weather condition'),
    humidity: z.number().describe('Humidity percentage'),
    windSpeed: z.number().describe('Wind speed'),
  }),
  execute: async ({ location, units }, context) => {
    // Your weather API call would go here
    return {
      location,
      temperature: units === 'celsius' ? 8 : 46,
      units,
      condition: 'partly cloudy',
      humidity: 72,
      windSpeed: 15,
    };
  },
})
`;

    fs.writeFileSync(
      path.join(absolutePath, "getWeather.ts"),
      getWeatherContent
    );

    // Run npm install
    console.log("Installing dependencies...");
    execSync("npm install", {
      cwd: absolutePath,
      stdio: "inherit",
    });

    console.log("\nProject initialized successfully!");
  });

program
  .command("build")
  .description("Build the agent (compile TypeScript tools)")
  .argument("<tools-path>", "path to the tools directory")
  .argument("[output-path]", "output directory for compiled tools", "dist")
  .action((toolsPath: string, outputPath: string) => {
    try {
      const runtimePath = buildAgent(toolsPath, outputPath, { verbose: true });
      console.log(`\n✓ Agent built successfully at: ${runtimePath}`);
    } catch (error) {
      console.error(
        `\nError: ${error instanceof Error ? error.message : error}`
      );
      process.exit(1);
    }
  });

program
  .command("run")
  .description("Run the agent server and send a prompt")
  .option("-p, --port <port>", "port to run the agent server on", "3000")
  .action(async (options: { port: string }) => {
    const port = options.port;

    // Use .together-agent convention in current directory
    const toolsPath = path.resolve(process.cwd(), '.together-agent');

    // Validate .together-agent directory exists
    if (!fs.existsSync(toolsPath)) {
      console.error('Error: .together-agent directory not found');
      console.error('Run "together-agent creator" to create and edit tools first');
      process.exit(1);
    }

    // Load environment variables from .env file
    const envPath = path.resolve(process.cwd(), '.env');
    const toolEnv: Record<string, string> = {};

    if (fs.existsSync(envPath)) {
      const result = dotenvConfig({ path: envPath });
      if (result.parsed) {
        Object.assign(toolEnv, result.parsed);
        console.log(`Loaded ${Object.keys(result.parsed).length} environment variable(s) from ${envPath}`);
      }
    } else {
      console.log('No .env file found, proceeding without environment variables');
    }

    const apiKey = process.env.TOGETHER_API_KEY;

    if (!apiKey) {
      console.error("Error: TOGETHER_API_KEY environment variable is required");
      process.exit(1);
    }

    // Build the agent to dist directory (so node_modules can be resolved)
    const buildPath = path.join(toolsPath, "dist");

    // Remove existing dist directory to ensure clean build
    if (fs.existsSync(buildPath)) {
      fs.rmSync(buildPath, { recursive: true, force: true });
    }

    let toolsRuntimePath: string;
    try {
      toolsRuntimePath = buildAgent(toolsPath, buildPath, { verbose: true });
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }

    console.log(`Starting agent server on port ${port}...`);

    // Get the path to the agent script
    const agentPath = path.join(__dirname, "agent", "index.js");

    // Start the agent server
    const agentProcess = spawn("node", [agentPath], {
      env: {
        ...process.env,
        PORT: port,
        TOOLS_PATH: toolsRuntimePath,
        WORKSPACE_PATH: process.cwd(),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let serverReady = false;

    agentProcess.stdout?.on("data", (data) => {
      const output = data.toString();
      console.log(output.trim());

      if (output.includes("Agent server running")) {
        serverReady = true;
        // Give the server a moment to fully initialize
        setTimeout(promptUser, 500);
      }
    });

    agentProcess.stderr?.on("data", (data) => {
      console.error(`Server error: ${data}`);
    });

    agentProcess.on("close", (code) => {
      if (code !== 0 && code !== null) {
        console.error(`Agent server exited with code ${code}`);
        process.exit(code);
      }
    });

    // Handle Ctrl+C gracefully
    process.on("SIGINT", () => {
      console.log("\n\nShutting down...");
      agentProcess.kill();
      process.exit(0);
    });

    const promptUser = () => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      rl.question("\nEnter your prompt (or 'exit' to quit): ", async (prompt) => {
        rl.close();

        const trimmedPrompt = prompt.trim();

        if (!trimmedPrompt) {
          console.error("Error: Prompt cannot be empty");
          promptUser();
          return;
        }

        if (trimmedPrompt.toLowerCase() === "exit") {
          console.log("\nExiting...");
          agentProcess.kill();
          process.exit(0);
        }

        console.log("\nSending prompt to agent...\n");

        try {
          const requestBody = {
            prompt: trimmedPrompt,
            apiKey,
            secrets: toolEnv,
          };

          const response = await fetch(`http://localhost:${port}/prompt`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody),
          });

          if (!response.ok) {
            console.error(`Server returned status ${response.status}: ${response.statusText}`);
            const text = await response.text();
            console.error("Response body:", text);
            agentProcess.kill();
            process.exit(1);
          }

          if (!response.body) {
            console.error("Error: Server returned no body");
            agentProcess.kill();
            process.exit(1);
          }

          // Process SSE stream
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let hasError = false;

          // Track custom tool calls to show them as single entries
          const pendingToolCalls = new Map<string, { toolName: string; args: any }>();

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
                    try {
                      console.log("\n" + "─".repeat(70));
                      console.log("🔐 APPROVAL REQUIRED");
                      console.log("Payload:", JSON.stringify(message.payload, null, 2));
                      console.log("─".repeat(70));

                      // Prompt user for yes/no
                      const approvalRl = readline.createInterface({
                        input: process.stdin,
                        output: process.stdout,
                      });

                      const answer = await new Promise<string>((resolve) => {
                        approvalRl.question("Approve? (yes/no): ", resolve);
                      });

                      approvalRl.close();

                      const approved = answer.trim().toLowerCase() === "yes";

                      // Send approval response to server
                      const approvalResponse = await fetch(`http://localhost:${port}/prompt/approval`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          approvalId: message.approvalId,
                          approved,
                        }),
                      });

                      if (!approvalResponse.ok) {
                        console.error(`Failed to send approval response: ${approvalResponse.status}`);
                      }

                      console.log(approved ? "✅ Approved" : "❌ Rejected");
                    } catch (error) {
                      console.error("Error handling approval request:", error);
                    }
                    continue;
                  }

                  switch (message.type) {
                    case "discover_code_tools":
                      const searchTerms = message.terms;
                      const matchedToolNames = message.matchedTools && message.matchedTools.length > 0
                        ? message.matchedTools.map((tool: { name: string }) => tool.name).join(", ")
                        : "none";
                      console.log(`\n\x1b[90m🔍 Discovery: "${searchTerms}" → [${matchedToolNames}]\x1b[0m`);
                      break;

                    case "journal_entry_created":
                      console.log("\n" + "─".repeat(70));
                      console.log("📓 JOURNAL ENTRY CREATED");
                      console.log(`Entry ${message.entryIndex}: "${message.title}"`);
                      console.log("─".repeat(70));
                      break;

                    case "journal_entries_read":
                      console.log("\n" + "─".repeat(70));
                      console.log("📖 JOURNAL ENTRIES READ");
                      console.log(`Read entries: ${message.entryIndices.join(", ")}`);
                      console.log("─".repeat(70));
                      break;

                    case "journal_entries_compressed":
                      console.log("\n" + "─".repeat(70));
                      console.log("🗜️  JOURNAL ENTRIES COMPRESSED");
                      console.log("Compressed entries:");
                      message.compressedEntries.forEach((entry: { index: number; title: string }) => {
                        console.log(`  - Entry ${entry.index}: "${entry.title}"`);
                      });
                      console.log("─".repeat(70));
                      break;

                    case "code_execution_started":
                      console.log("\n" + "─".repeat(70));
                      console.log("💻 CODE EXECUTION");
                      console.log(message.code);
                      console.log("─".repeat(70));
                      break;

                    case "code_execution_completed":
                      if (message.error) {
                        console.log("\n" + "─".repeat(70));
                        console.log("💻 CODE EXECUTION - ERROR");
                        console.log("Error:", message.error);
                        console.log("─".repeat(70));
                      } else if (message.logs && message.logs.length > 0) {
                        console.log("\n" + "─".repeat(70));
                        console.log("💻 CODE EXECUTION - LOGS");
                        message.logs.forEach((log: string) => console.log(log));
                        console.log("─".repeat(70));
                      }
                      break;

                    case "custom_tool_call_started":
                      // Store the tool call info to display when completed
                      pendingToolCalls.set(message.callId, {
                        toolName: message.toolName,
                        args: message.args,
                      });
                      break;

                    case "custom_tool_call_completed":
                      // Show tool call as single entry with status and input
                      const toolCall = pendingToolCalls.get(message.callId);
                      if (toolCall) {
                        console.log("\n" + "─".repeat(70));
                        if (message.error) {
                          console.log(`❌ ${toolCall.toolName.toUpperCase()} - Error: ${message.error}`);
                        } else {
                          console.log(`✅ ${toolCall.toolName.toUpperCase()}`);
                        }
                        if (toolCall.args) {
                          console.log(JSON.stringify(toolCall.args, null, 2));
                        }
                        console.log("─".repeat(70));
                        pendingToolCalls.delete(message.callId);
                      }
                      break;

                    case "text":
                      // Only process if there's actual content
                      if (message.content) {
                        console.log("\n" + "─".repeat(70));
                        console.log("💬 RESPONSE");
                        console.log(message.content);
                        console.log("─".repeat(70));
                      }
                      break;

                    case "error":
                      console.error("\nError:", message.error);
                      hasError = true;
                      break;

                    case "done":
                      // Display usage info if available
                      if (message.contextSize !== undefined || message.cumulativeInput !== undefined || message.cumulativeOutput !== undefined) {
                        const contextInfo = message.contextSize !== undefined ? `Context: ${message.contextSize.toLocaleString()}` : '';
                        const inputInfo = message.cumulativeInput !== undefined ? `Input: ${message.cumulativeInput.toLocaleString()}` : '';
                        const outputInfo = message.cumulativeOutput !== undefined ? `Output: ${message.cumulativeOutput.toLocaleString()}` : '';
                        const turnsInfo = message.turns !== undefined && message.totalTurns !== undefined
                          ? `Turns: ${message.turns}/${message.totalTurns}`
                          : '';
                        const parts = [contextInfo, inputInfo, outputInfo, turnsInfo].filter(Boolean);
                        if (parts.length > 0) {
                          console.log(`\x1b[90m${parts.join(' | ')}\x1b[0m`); // Gray text
                        }
                      }
                      // Conversation continues automatically
                      break;
                  }
                } catch (e) {
                  console.error("Failed to parse SSE message:", data);
                }
              }
            }
          }

          if (hasError) {
            agentProcess.kill();
            process.exit(1);
          }

          // Continue the conversation
          promptUser();
        } catch (error) {
          console.error(
            "Failed to send request:",
            error instanceof Error ? error.message : error
          );
          agentProcess.kill();
          process.exit(1);
        }
      });
    };

    // Timeout in case server doesn't start
    setTimeout(() => {
      if (!serverReady) {
        console.error("Error: Server failed to start within 10 seconds");
        agentProcess.kill();
        process.exit(1);
      }
    }, 10000);
  });

program
  .command("creator")
  .description("Run the creator agent to build and modify tools")
  .option("-p, --port <port>", "port to run the agent server on", "3000")
  .action(async (options: { port: string }) => {
    const port = options.port;

    // Use .together-agent convention in current directory
    const agentToolsPath = path.resolve(process.cwd(), '.together-agent');

    // Create .together-agent directory if it doesn't exist
    if (!fs.existsSync(agentToolsPath)) {
      fs.mkdirSync(agentToolsPath, { recursive: true });
      console.log('Created .together-agent directory');
    }

    // Load environment variables from .env file in current directory
    const envPath = path.resolve(process.cwd(), '.env');
    const toolEnv: Record<string, string> = {};

    if (fs.existsSync(envPath)) {
      const result = dotenvConfig({ path: envPath });
      if (result.parsed) {
        Object.assign(toolEnv, result.parsed);
        console.log(`Loaded ${Object.keys(result.parsed).length} environment variable(s) from ${envPath}`);
      }
    } else {
      console.log('No .env file found, proceeding without environment variables');
    }

    const apiKey = process.env.TOGETHER_API_KEY;

    if (!apiKey) {
      console.error("Error: TOGETHER_API_KEY environment variable is required");
      process.exit(1);
    }

    // Use pre-built creator-agent tools
    const creatorAgentPath = path.join(__dirname, "creator-agent");

    if (!fs.existsSync(creatorAgentPath)) {
      console.error(`Error: Creator agent not found at: ${creatorAgentPath}`);
      console.error("Please ensure the project is built correctly (pnpm build)");
      process.exit(1);
    }

    // Verify tools exist
    const toolFiles = fs.readdirSync(creatorAgentPath).filter(f => f.endsWith('.js'));

    // Get the path to the agent script
    const agentServerPath = path.join(__dirname, "agent", "index.js");

    // Start the agent server with creator-agent tools
    const agentProcess = spawn("node", [agentServerPath], {
      env: {
        ...process.env,
        PORT: port,
        TOOLS_PATH: creatorAgentPath,
        WORKSPACE_PATH: process.cwd(),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let serverReady = false;

    agentProcess.stdout?.on("data", (data) => {
      const output = data.toString();
      console.log(output.trim());

      if (output.includes("Agent server running")) {
        serverReady = true;
        // Give the server a moment to fully initialize
        setTimeout(promptUser, 500);
      }
    });

    agentProcess.stderr?.on("data", (data) => {
      console.error(`Server error: ${data}`);
    });

    agentProcess.on("close", (code) => {
      if (code !== 0 && code !== null) {
        console.error(`Agent server exited with code ${code}`);
        process.exit(code);
      }
    });

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const promptUser = () => {
      rl.question("\nEnter your prompt: ", async (prompt) => {
        const trimmedPrompt = prompt.trim();

        if (!trimmedPrompt) {
          console.log("Empty prompt, please try again.");
          promptUser();
          return;
        }

        if (trimmedPrompt.toLowerCase() === "exit") {
          console.log("Goodbye!");
          rl.close();
          agentProcess.kill();
          process.exit(0);
        }

        try {
          const response = await fetch(`http://localhost:${port}/prompt`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              prompt: trimmedPrompt,
              apiKey,
              secrets: toolEnv,
            }),
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error("No response body");
          }

          const decoder = new TextDecoder();
          let buffer = "";
          let hasError = false;

          // Track custom tool calls to show them as single entries
          const pendingToolCalls = new Map<string, { toolName: string; args: any }>();

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
                    try {
                      console.log("\n" + "─".repeat(70));
                      console.log("🔐 APPROVAL REQUIRED");
                      console.log("Payload:", JSON.stringify(message.payload, null, 2));
                      console.log("─".repeat(70));

                      // Prompt user for yes/no
                      const approvalRl = readline.createInterface({
                        input: process.stdin,
                        output: process.stdout,
                      });

                      const answer = await new Promise<string>((resolve) => {
                        approvalRl.question("Approve? (yes/no): ", resolve);
                      });

                      approvalRl.close();

                      const approved = answer.trim().toLowerCase() === "yes";

                      // Send approval response to server
                      const approvalResponse = await fetch(`http://localhost:${port}/prompt/approval`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          approvalId: message.approvalId,
                          approved,
                        }),
                      });

                      if (!approvalResponse.ok) {
                        console.error(`Failed to send approval response: ${approvalResponse.status}`);
                      }

                      console.log(approved ? "✅ Approved" : "❌ Rejected");
                    } catch (error) {
                      console.error("Error handling approval request:", error);
                    }
                    continue;
                  }

                  switch (message.type) {
                    case "discover_code_tools":
                      const searchTerms = message.terms;
                      const matchedToolNames = message.matchedTools && message.matchedTools.length > 0
                        ? message.matchedTools.map((tool: { name: string }) => tool.name).join(", ")
                        : "none";
                      console.log(`\n\x1b[90m🔍 Discovery: "${searchTerms}" → [${matchedToolNames}]\x1b[0m`);
                      break;

                    case "journal_entry_created":
                      console.log("\n" + "─".repeat(70));
                      console.log("📓 JOURNAL ENTRY CREATED");
                      console.log(`Entry ${message.entryIndex}: "${message.title}"`);
                      console.log("─".repeat(70));
                      break;

                    case "journal_entries_read":
                      console.log("\n" + "─".repeat(70));
                      console.log("📖 JOURNAL ENTRIES READ");
                      console.log(`Read entries: ${message.entryIndices.join(", ")}`);
                      console.log("─".repeat(70));
                      break;

                    case "journal_entries_compressed":
                      console.log("\n" + "─".repeat(70));
                      console.log("🗜️  JOURNAL ENTRIES COMPRESSED");
                      console.log("Compressed entries:");
                      message.compressedEntries.forEach((entry: { index: number; title: string }) => {
                        console.log(`  - Entry ${entry.index}: "${entry.title}"`);
                      });
                      console.log("─".repeat(70));
                      break;

                    case "code_execution_started":
                      console.log("\n" + "─".repeat(70));
                      console.log("💻 CODE EXECUTION");
                      console.log(message.code);
                      console.log("─".repeat(70));
                      break;

                    case "code_execution_completed":
                      if (message.error) {
                        console.log("\n" + "─".repeat(70));
                        console.log("💻 CODE EXECUTION - ERROR");
                        console.log("Error:", message.error);
                        console.log("─".repeat(70));
                      } else if (message.logs && message.logs.length > 0) {
                        console.log("\n" + "─".repeat(70));
                        console.log("💻 CODE EXECUTION - LOGS");
                        message.logs.forEach((log: string) => console.log(log));
                        console.log("─".repeat(70));
                      }
                      break;

                    case "custom_tool_call_started":
                      // Store the tool call info to display when completed
                      pendingToolCalls.set(message.callId, {
                        toolName: message.toolName,
                        args: message.args,
                      });
                      break;

                    case "custom_tool_call_completed":
                      // Show tool call as single entry with status and input
                      const toolCall = pendingToolCalls.get(message.callId);
                      if (toolCall) {
                        console.log("\n" + "─".repeat(70));
                        if (message.error) {
                          console.log(`❌ ${toolCall.toolName.toUpperCase()} - Error: ${message.error}`);
                        } else {
                          console.log(`✅ ${toolCall.toolName.toUpperCase()}`);
                        }
                        if (toolCall.args) {
                          console.log(JSON.stringify(toolCall.args, null, 2));
                        }
                        console.log("─".repeat(70));
                        pendingToolCalls.delete(message.callId);
                      }
                      break;

                    case "text":
                      // Only process if there's actual content
                      if (message.content) {
                        console.log("\n" + "─".repeat(70));
                        console.log("💬 RESPONSE");
                        console.log(message.content);
                        console.log("─".repeat(70));
                      }
                      break;

                    case "error":
                      console.error("\nError:", message.error);
                      hasError = true;
                      break;

                    case "done":
                      // Display usage info if available
                      if (message.contextSize !== undefined || message.cumulativeInput !== undefined || message.cumulativeOutput !== undefined) {
                        const contextInfo = message.contextSize !== undefined ? `Context: ${message.contextSize.toLocaleString()}` : '';
                        const inputInfo = message.cumulativeInput !== undefined ? `Input: ${message.cumulativeInput.toLocaleString()}` : '';
                        const outputInfo = message.cumulativeOutput !== undefined ? `Output: ${message.cumulativeOutput.toLocaleString()}` : '';
                        const turnsInfo = message.turns !== undefined && message.totalTurns !== undefined
                          ? `Turns: ${message.turns}/${message.totalTurns}`
                          : '';
                        const parts = [contextInfo, inputInfo, outputInfo, turnsInfo].filter(Boolean);
                        if (parts.length > 0) {
                          console.log(`\x1b[90m${parts.join(' | ')}\x1b[0m`); // Gray text
                        }
                      }
                      // Conversation continues automatically
                      break;
                  }
                } catch (e) {
                  console.error("Failed to parse SSE message:", data);
                }
              }
            }
          }

          if (hasError) {
            agentProcess.kill();
            process.exit(1);
          }

          // Continue the conversation
          promptUser();
        } catch (error) {
          console.error(
            "Failed to send request:",
            error instanceof Error ? error.message : error
          );
          agentProcess.kill();
          process.exit(1);
        }
      });
    };

    // Timeout in case server doesn't start
    setTimeout(() => {
      if (!serverReady) {
        console.error("Error: Server failed to start within 10 seconds");
        agentProcess.kill();
        process.exit(1);
      }
    }, 10000);
  });

program
  .command("deploy")
  .description("Deploy the agent to CodeSandbox")
  .argument("<tools-path>", "path to the tools directory")
  .action((toolsPath: string) => {
    const absoluteToolsPath = path.resolve(toolsPath);

    // Helper function to show spinner
    const spinner = (message: string) => {
      const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
      let i = 0;
      process.stdout.write(message);
      const interval = setInterval(() => {
        process.stdout.write(`\r${frames[i]} ${message}`);
        i = (i + 1) % frames.length;
      }, 80);
      return {
        stop: (success: boolean = true, completionMessage?: string) => {
          clearInterval(interval);
          const finalMessage = completionMessage || message;
          process.stdout.write(`\r${success ? '✓' : '✗'} ${finalMessage}\n`);
        }
      };
    };

    // Build the agent to dist directory (so node_modules can be resolved)
    const buildSpinner = spinner("Building agent...");
    const buildPath = path.join(absoluteToolsPath, "dist");

    // Remove existing dist directory to ensure clean build
    if (fs.existsSync(buildPath)) {
      fs.rmSync(buildPath, { recursive: true, force: true });
    }

    let compiledToolsPath: string;
    try {
      compiledToolsPath = buildAgent(toolsPath, buildPath, { verbose: false });
      buildSpinner.stop(true, "Agent built successfully");
    } catch (error) {
      buildSpinner.stop(false);
      console.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }

    // Create a temp folder for deployment
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "together-agent-deploy-"));

    try {
      // Copy the agent folder from dist first
      const agentSourcePath = path.join(__dirname, "agent");
      const tempAgentPath = path.join(tempDir, "agent");
      copyRecursiveSync(agentSourcePath, tempAgentPath);

      // Copy the compiled tools inside the agent folder
      const tempToolsPath = path.join(tempAgentPath, "tools");
      copyRecursiveSync(compiledToolsPath, tempToolsPath);

      // Copy package.json without devDependencies and scripts
      const packageJsonPath = path.join(absoluteToolsPath, "package.json");
      if (fs.existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
        delete packageJson.devDependencies;
        delete packageJson.scripts;
        fs.writeFileSync(
          path.join(tempToolsPath, "package.json"),
          JSON.stringify(packageJson, null, 2)
        );
      }

      // Create .codesandbox folder with tasks.json
      const codesandboxDir = path.join(tempDir, ".codesandbox");
      fs.mkdirSync(codesandboxDir, { recursive: true });

      // Calculate relative path from temp root to tools folder (inside agent folder)
      const relativeToolsPath = "./agent/tools";

      const tasksJson = {
        setupTasks: [`cd ${relativeToolsPath} && npm install`],
        tasks: {
          agent: {
            name: "Agent",
            command: `TOOLS_PATH=${relativeToolsPath} node ./agent/index.js`,
            runAtStart: true,
          },
        },
      };

      fs.writeFileSync(
        path.join(codesandboxDir, "tasks.json"),
        JSON.stringify(tasksJson, null, 2)
      );

      // Get Together API key for authentication
      const apiKey = process.env.TOGETHER_API_KEY;
      if (!apiKey) {
        console.error("\nError: TOGETHER_API_KEY environment variable is required");
        console.error("Set it in your .env file or export it:");
        console.error("  export TOGETHER_API_KEY=your_api_key");
        fs.rmSync(tempDir, { recursive: true, force: true });
        process.exit(1);
      }

      // Set CSB_API_KEY to Together API key for authentication
      process.env.CSB_API_KEY = apiKey;

      const deploySpinner = spinner("Deploying agent...");

      // Find the csb CLI binary
      const csbBinaryPath = path.join(
        __dirname,
        "../node_modules/@codesandbox/sdk/dist/bin/codesandbox.mjs"
      );

      // Capture output to extract template ID
      let outputBuffer = "";

      // Run csb build command
      const buildProcess = spawn(
        "node",
        [
          csbBinaryPath,
          "build",
          tempDir,
          "--ports",
          "3000",
          "--ci",
          "--name",
          "Together Agent"
        ],
        {
          env: { ...process.env, CSB_API_KEY: apiKey },
          stdio: "pipe",
        }
      );

      // Capture stdout
      buildProcess.stdout?.on("data", (data) => {
        outputBuffer += data.toString();
      });

      // Capture stderr
      buildProcess.stderr?.on("data", (data) => {
        outputBuffer += data.toString();
      });

      buildProcess.on("close", (code) => {
        deploySpinner.stop(code === 0, "Agent deployed successfully");

        // Clean up temp deployment directory and build directory
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.rmSync(buildPath, { recursive: true, force: true });

        if (code !== 0 && code !== null) {
          console.error("\nDeployment failed!");
          console.error(outputBuffer);
          process.exit(code);
        }

        // Extract template ID using regex
        const templateIdMatch = outputBuffer.match(/Template created with tag: (pt_\w+)/);
        const templateId = templateIdMatch ? templateIdMatch[1] : null;

        if (templateId) {
          console.log(`\nAgent ID: ${templateId}`);
        } else {
          console.log("\nCould not extract agent ID from deployment output.");
        }

        process.exit(0);
      });

      // Handle Ctrl+C gracefully
      process.on("SIGINT", () => {
        console.log("\n\nShutting down...");
        deploySpinner.stop(false);
        buildProcess.kill();
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.rmSync(buildPath, { recursive: true, force: true });
        process.exit(0);
      });
    } catch (error) {
      // Clean up on error
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.rmSync(buildPath, { recursive: true, force: true });
      throw error;
    }
  });

// Helper function to copy directories recursively
function copyRecursiveSync(src: string, dest: string) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats && stats.isDirectory();

  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach((childItemName) => {
      copyRecursiveSync(
        path.join(src, childItemName),
        path.join(dest, childItemName)
      );
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

program.parse();
