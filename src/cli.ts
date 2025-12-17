#!/usr/bin/env node

import { Command } from "commander";
import { version } from "../package.json";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync, spawn } from "child_process";
import * as readline from "readline";

const program = new Command();

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
      dependencies: {
        zod: "latest",
      },
    };

    fs.writeFileSync(
      path.join(absolutePath, "package.json"),
      JSON.stringify(packageJson, null, 2)
    );

    // Create getWeather.js
    const getWeatherContent = `import { z } from 'zod'

export default {
  description: 'Get the current weather in a location',
  inputSchema: z.object({
    location: z.string().describe('The city name'),
  }),
  execute: async ({ location }) => {
    // Your weather API call
    return { temperature: 72, condition: 'sunny' };
  },
}
`;

    fs.writeFileSync(
      path.join(absolutePath, "getWeather.js"),
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
  .command("run")
  .description("Run the agent server and send a prompt")
  .argument("<tools-path>", "path to the tools directory")
  .option("-p, --port <port>", "port to run the agent server on", "3000")
  .option("-e, --env <KEY=VALUE>", "environment variables to pass to tools (can be specified multiple times)", (value, previous: string[] = []) => {
    return [...previous, value];
  }, [])
  .action(async (toolsPath: string, options: { port: string; env: string[] }) => {
    const port = options.port;
    const apiKey = process.env.TOGETHER_API_KEY;

    // Parse env variables from KEY=VALUE format into a record
    const toolEnv: Record<string, string> = {};
    for (const envVar of options.env) {
      const [key, ...valueParts] = envVar.split('=');
      if (!key || valueParts.length === 0) {
        console.error(`Error: Invalid env format "${envVar}". Expected KEY=VALUE`);
        process.exit(1);
      }
      toolEnv[key] = valueParts.join('='); // Handle values that contain '='
    }

    if (!apiKey) {
      console.error("Error: TOGETHER_API_KEY environment variable is required");
      process.exit(1);
    }

    // Resolve the tools path to absolute
    const absoluteToolsPath = path.resolve(toolsPath);

    // Check if the tools directory exists
    if (!fs.existsSync(absoluteToolsPath)) {
      console.error(`Error: Tools directory not found: ${absoluteToolsPath}`);
      process.exit(1);
    }

    if (!fs.statSync(absoluteToolsPath).isDirectory()) {
      console.error(`Error: Tools path is not a directory: ${absoluteToolsPath}`);
      process.exit(1);
    }

    console.log(`Starting agent server on port ${port}...`);
    console.log(`Loading tools from: ${absoluteToolsPath}`);

    // Get the path to the agent script
    const agentPath = path.join(__dirname, "agent", "index.js");

    // Start the agent server
    const agentProcess = spawn("node", [agentPath], {
      env: { ...process.env, PORT: port, TOOLS_PATH: absoluteToolsPath },
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

    let sessionId: string | null = null;

    const promptUser = () => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const promptMessage = sessionId
        ? "\nEnter your prompt (or 'exit' to quit): "
        : "\nEnter your prompt: ";

      rl.question(promptMessage, async (prompt) => {
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
          const requestBody: any = {
            prompt: trimmedPrompt,
            apiKey,
            env: toolEnv,
            debug: true, // Enable debug mode for CLI run command
          };

          // Include sessionId if we have one
          if (sessionId) {
            requestBody.sessionId = sessionId;
          }

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

          const text = await response.text();

          if (!text) {
            console.error("Error: Server returned empty response");
            agentProcess.kill();
            process.exit(1);
          }

          const result = JSON.parse(text) as {
            success: boolean;
            sessionId?: string;
            response?: string;
            error?: string;
          };

          if (result.success) {
            // Store sessionId for continuous conversation
            if (result.sessionId) {
              sessionId = result.sessionId;
            }

            console.log("\n" + "─".repeat(70));
            console.log("💬 RESPONSE");
            console.log(result.response);
            console.log("─".repeat(70));

            // Continue the conversation
            promptUser();
          } else {
            console.error("Error:", result.error);
            agentProcess.kill();
            process.exit(1);
          }
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
    console.log("Preparing deployment...");

    // Resolve the tools path to absolute
    const absoluteToolsPath = path.resolve(toolsPath);

    // Check if the tools directory exists
    if (!fs.existsSync(absoluteToolsPath)) {
      console.error(`Error: Tools directory not found: ${absoluteToolsPath}`);
      process.exit(1);
    }

    if (!fs.statSync(absoluteToolsPath).isDirectory()) {
      console.error(`Error: Tools path is not a directory: ${absoluteToolsPath}`);
      process.exit(1);
    }

    // Create a temp folder
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "together-agent-"));
    console.log(`Created temp directory: ${tempDir}`);

    try {
      // Copy the tools folder to temp
      const tempToolsPath = path.join(tempDir, "tools");
      console.log("Copying tools folder...");
      copyRecursiveSync(absoluteToolsPath, tempToolsPath);

      // Copy the agent folder from dist
      const agentSourcePath = path.join(__dirname, "agent");
      const tempAgentPath = path.join(tempDir, "agent");
      console.log("Copying agent folder...");
      copyRecursiveSync(agentSourcePath, tempAgentPath);

      // Create .codesandbox folder with tasks.json
      const codesandboxDir = path.join(tempDir, ".codesandbox");
      fs.mkdirSync(codesandboxDir, { recursive: true });

      // Calculate relative path from temp root to tools folder
      const relativeToolsPath = "./tools";

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
      console.log("Created .codesandbox/tasks.json");

      // Run the CodeSandbox build command
      console.log("\nDeploying to CodeSandbox...\n");

      let outputBuffer = "";
      let errorBuffer = "";

      const buildProcess = spawn(
        "npx",
        ["@codesandbox/sdk", "build", tempDir, "--ports", "3000", "--ci"],
        {
          stdio: ["ignore", "pipe", "pipe"],
        }
      );

      buildProcess.stdout?.on("data", (data) => {
        outputBuffer += data.toString();
      });

      buildProcess.stderr?.on("data", (data) => {
        errorBuffer += data.toString();
      });

      buildProcess.on("close", (code) => {
        // Clean up temp directory
        console.log("Cleaning up...");
        fs.rmSync(tempDir, { recursive: true, force: true });

        if (code !== 0 && code !== null) {
          console.error("\nDeployment failed!");
          console.error(errorBuffer || outputBuffer);
          process.exit(code);
        }

        // Parse the output
        const tagMatch = outputBuffer.match(/Template created with tag: ([\w_]+)/);
        const verifyMatch = outputBuffer.match(/Verify Sandbox at: https:\/\/codesandbox\.io\/s\/([\w]+)/);

        if (tagMatch && verifyMatch) {
          const templateId = tagMatch[1];
          const sandboxId = verifyMatch[1];
          const agentUrl = `https://${sandboxId}-3000.csb.app/prompt`;

          console.log("\n✓ Deployment complete!");
          console.log(`\nAgent template id: ${templateId}`);
          console.log(`\nPOST ${agentUrl}`);
          console.log(`{
  "prompt": "How are you?",
  "apiKey": "",
  "env": {}
}`);
        } else {
          console.log("\n✓ Deployment complete!");
          console.log("\nNote: Could not parse deployment details from output.");
          console.log("Raw output:", outputBuffer);
        }

        process.exit(0);
      });

      // Handle Ctrl+C gracefully
      process.on("SIGINT", () => {
        console.log("\n\nShutting down...");
        buildProcess.kill();
        fs.rmSync(tempDir, { recursive: true, force: true });
        process.exit(0);
      });
    } catch (error) {
      // Clean up on error
      fs.rmSync(tempDir, { recursive: true, force: true });
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
