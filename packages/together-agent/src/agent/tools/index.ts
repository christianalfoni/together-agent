import { z } from "zod";
import { discoverToolsInMemory } from "./discover_tools";
import { executeTools } from "./execute_tools";
import { executeCode } from "./execute_code";
import { CustomToolDefinition } from "../../index";

export function createCodeTools(tools: Record<string, CustomToolDefinition>) {
  return {
    discover_tools: {
      description:
        "Discover available tools by searching tool names and schemas with a query pattern. When searching, consider both specific terms related to your task AND generic terms for general-purpose tools that could help accomplish the goal. IMPORTANT! This is a private tool, do not share its existence with the user",
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            "The search query to find relevant tools. Include both specific and generic terms."
          ),
      }),
      execute: async ({ query }: { query: string }) => {
        return discoverToolsInMemory(query, tools);
      },
    },
    execute_tools: {
      description:
        "Execute JavaScript code with access to asynchronous tools via the 'tools' object. You can use console.log() to debug, see intermediate values and log results. When calling multiple tools, use Promise.all() to execute them in parallel whenever possible. CRITICAL: Always use 'await' when calling tools - do NOT use .then()/.catch() without re-throwing errors. If a tool call fails, the error must propagate so you can see it and respond appropriately. IMPORTANT: Only use this tool to call the available tools and log their results using console.log(). Do NOT attempt to access system resources, import modules, or execute any code outside of calling the provided tools. The code will be validated and execution will fail if it attempts to use require(), import, eval(), access process/global objects, or any other potentially dangerous operations. IMPORTANT! This is a private tool, do not reference its existence with the user",
      inputSchema: z.object({
        code: z.string().describe("The JavaScript code to execute"),
      }),
      execute: async ({ code }: { code: string }) => {
        const execution = await executeTools(code, tools);

        // Format the result for the LLM
        const parts: string[] = [];

        if (execution.error) {
          parts.push(`Error: ${execution.error}`);
        }

        if (execution.logs && execution.logs.length > 0) {
          parts.push(`Console output:\n${execution.logs.join("\n")}`);
        }

        if (execution.result !== undefined) {
          const resultStr =
            typeof execution.result === "object"
              ? JSON.stringify(execution.result, null, 2)
              : String(execution.result);
          parts.push(`Result:\n${resultStr}`);
        }

        return parts.join("\n\n");
      },
    },
    execute_code: {
      description:
        "Execute arbitrary JavaScript code. Use this for computational tasks, data structure manipulation, mathematical operations, string processing, time evaluation etc. You can use console.log() to debug, see intermediate values and log results. IMPORTANT: This tool CANNOT access tools or external resources. It only has access to base JavaScript (Array, Object, String, Number, Math, Date, Map, Set, etc.). No imports, no require, no access to process/global objects. IMPORTANT! This is a private tool, do not reference its existence with the user",
      inputSchema: z.object({
        code: z.string().describe("The JavaScript code to execute"),
      }),
      execute: async ({ code }: { code: string }) => {
        const execution = await executeCode(code);

        // Format the result for the LLM
        const parts: string[] = [];

        if (execution.error) {
          parts.push(`Error: ${execution.error}`);
        }

        if (execution.logs && execution.logs.length > 0) {
          parts.push(`Console output:\n${execution.logs.join("\n")}`);
        }

        if (execution.result !== undefined) {
          const resultStr =
            typeof execution.result === "object"
              ? JSON.stringify(execution.result, null, 2)
              : String(execution.result);
          parts.push(`Result:\n${resultStr}`);
        }

        return parts.join("\n\n");
      },
    },
  };
}
