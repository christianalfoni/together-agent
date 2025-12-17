import { z } from "zod";
import { discoverToolsInMemory } from "./discover_tools";
import { executeTools } from "./execute_tools";
import { executeCode } from "./execute_code";

type Tool = {
  description?: string;
  inputSchema: z.ZodType<any>;
  execute: (params: any) => Promise<any> | any;
};

export function createCodeTools(tools: Record<string, Tool>) {
  return {
    discover_tools: {
      description:
        "Discover available tools by searching tool names and schemas with a query pattern. When searching, consider both specific terms related to your task AND generic terms for general-purpose tools that could help accomplish the goal.",
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            "The search query to find relevant tools. Include both specific and generic terms."
          ),
      }),
      execute: async ({ query }: { query: string }) => {
        console.log("\n" + "─".repeat(70));
        console.log("🔍 DISCOVER_TOOLS");
        console.log(`Query: ${query}`);
        console.log("─".repeat(70));
        return discoverToolsInMemory(query, tools);
      },
    },
    execute_tools: {
      description:
        "Execute JavaScript code with access to tools via the 'tools' object. Return the result you want access to. You can use console.log() to debug and see intermediate values. IMPORTANT: Only use this tool to call the available tools and return their results. Do NOT attempt to access system resources, import modules, or execute any code outside of calling the provided tools. The code will be validated and execution will fail if it attempts to use require(), import, eval(), access process/global objects, or any other potentially dangerous operations.",
      inputSchema: z.object({
        code: z.string().describe("The JavaScript code to execute"),
      }),
      execute: async ({ code }: { code: string }) => {
        console.log("\n" + "─".repeat(70));
        console.log("⚙️  EXECUTE_TOOLS");
        console.log(code);
        console.log("─".repeat(70));
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
        "Execute arbitrary JavaScript code for calculations, data transformations, or complex logic. Use this for computational tasks, data structure manipulation, mathematical operations, string processing, etc. Return the result you want to receive. You can use console.log() to debug and see intermediate values. IMPORTANT: This tool CANNOT access tools or external resources. It only has access to base JavaScript (Array, Object, String, Number, Math, Date, Map, Set, etc.). No imports, no require, no access to process/global objects.",
      inputSchema: z.object({
        code: z.string().describe("The JavaScript code to execute"),
      }),
      execute: async ({ code }: { code: string }) => {
        console.log("\n" + "─".repeat(70));
        console.log("💻 EXECUTE_CODE");
        console.log(code);
        console.log("─".repeat(70));
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
