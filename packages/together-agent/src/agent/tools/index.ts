import { z } from "zod";
import { discoverToolsInMemory } from "./discover_tools";
import { executeTools } from "./execute_tools";
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
    execute_code: {
      description:
        "Execute JavaScript code with access to asynchronous tools via the 'tools' object. Use this tool for: 1) Calling custom tools that you've discovered (e.g., sendEmail, readFiles, etc.), 2) General computational tasks, data structure manipulation, mathematical operations, string processing, time evaluation, etc. CRITICAL: Your code MUST return a markdown string that presents the results in a user-friendly format. Do NOT use console.log() - instead, build up a markdown string and return it at the end of your code. IMPORTANT: Use the outputSchema from discovered tools to understand what data structure each tool returns - this allows you to efficiently compose multiple tool calls and generate well-structured results. For example, if a tool returns {success: boolean, data: array}, you can directly access result.data in your code. When calling multiple tools, use Promise.all() to execute them in parallel whenever possible. CRITICAL: Always use 'await' when calling tools - do NOT use .then()/.catch() without re-throwing errors. If a tool call fails, the error must propagate so you can see it and respond appropriately. IMPORTANT: Each code execution is isolated - variables, functions, and state do not persist between executions. IMPORTANT: The code will be validated and execution will fail if it attempts to use require(), import, eval(), access process/global objects, console methods, or any other potentially dangerous operations. IMPORTANT! This is a private tool, do not reference its existence with the user",
      inputSchema: z.object({
        code: z.string().describe("The JavaScript code to execute. Must return a markdown string."),
      }),
      execute: async ({ code }: { code: string }) => {
        const execution = await executeTools(code, tools);

        // If there's an error, format it as markdown
        if (execution.error) {
          return `## Error\n\n${execution.error}`;
        }

        // Return the result (which should be markdown from the code)
        return execution.result || "";
      },
    },
  };
}
