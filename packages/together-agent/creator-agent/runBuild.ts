// @ts-nocheck
import { z } from "zod";
import { tool } from "together-agent";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";

const execAsync = promisify(exec);

export default tool({
  native: true,
  discoveryTerms: [
    "build",
    "compile",
    "typescript",
    "tsc",
    "type",
    "error",
    "check",
    "validate",
    "test",
    "verify",
  ],
  inputSchema: z.object({}),
  outputSchema: z.object({
    success: z.boolean(),
    errors: z.string().optional(),
    message: z.string(),
  }),
  execute: async (input, context) => {
    const agentPath = path.join(context.workspacePath, ".together-agent");

    console.log("Running build in .together-agent...");

    try {
      // Check if .together-agent directory exists
      try {
        await fs.access(agentPath);
      } catch (error) {
        throw new Error(".together-agent directory not found");
      }

      // Run npm run build (which deletes dist and compiles)
      try {
        const { stdout, stderr } = await execAsync("npm run build", {
          cwd: agentPath,
        });

        console.log("Build completed successfully");

        return {
          success: true,
          message: "Build completed successfully with no errors",
        };
      } catch (error: any) {
        // npm run build returns non-zero exit code when there are type errors
        const errorOutput = error.stdout || error.stderr || error.message;

        console.log("Build failed with errors:");
        console.log(errorOutput);

        return {
          success: false,
          errors: errorOutput,
          message: "Build failed with type errors",
        };
      }
    } catch (error: any) {
      throw new Error(`Failed to run build: ${error.message}`);
    }
  },
});
