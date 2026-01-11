import { z } from "zod";
import { discoverToolsInMemory } from "./discover_tools";
import { executeTools } from "./execute_tools";
import { CustomToolDefinition } from "../../index";

export function createCodeTools(
  tools: Record<string, CustomToolDefinition>,
  addJournalEntry?: (title: string, markdown: string) => Promise<void>
) {
  return {
    execute_code_tools_discovery: {
      description: `Discover code tools that are available for use within execute_code via the codeTools object.`,
      inputSchema: z.object({
        terms: z.string().describe("The terms to find relevant code tools for execute_code"),
      }),
      execute: async ({ terms }: { terms: string }) => {
        return discoverToolsInMemory(terms, tools);
      },
    },
    execute_code: {
      description: `Execute JavaScript code with access to asynchronous code tools via the 'codeTools' object.

## Return Value
- MUST return a JSON-serializable object (use the outputSchema of code tools to structure your response)
- DO NOT return markdown strings - return structured data objects
- The data you return will be formatted by you in your text response to the user

## Example Code

\`\`\`js
const toolResult = await codeTools.someDiscoveredTool()

await codeTools.addJournalEntry('Helping with...', 'Got tool result: ' + JSON.stringify(toolResult, null, 2))

return toolResult // Return the data object directly
\`\`\`

- Always use await
- Always journal what you are doing
- Return JSON objects, not markdown strings

\`\`\`js
const [toolResult1, toolResult2] = await Promise.all([
  codeTools.someDiscoveredTool(),
  codeTools.anotherTool()
])

await codeTools.addJournalEntry('Helping with...', 'Got tool results: ' + JSON.stringify({toolResult1, toolResult2}, null, 2))

return { toolResult1, toolResult2 } // Return combined data
\`\`\`

- Favour parallel tool calling
- Always journal what you are doing
- Return structured JSON data

\`\`\`js
const data = await codeTools.getData()
const processedData = await codeTools.processData(data)

await codeTools.addJournalEntry('processing data...', 'Got tool results: ' + JSON.stringify(processedData, null, 2))

return processedData // Return the processed data object
\`\`\`

- Favour composing multiple code tools
- Always journal what you are doing
- Return structured data from execute_code
`,
      inputSchema: z.object({
        code: z
          .string()
          .describe(
            "The JavaScript code to execute. Must return a JSON-serializable object."
          ),
      }),
      execute: async ({ code }: { code: string }) => {
        const execution = await executeTools(code, tools, addJournalEntry);

        // If there's an error, return as JSON
        if (execution.error) {
          return JSON.stringify({ error: execution.error });
        }

        // Return the result as JSON string
        return JSON.stringify(execution.result || {});
      },
    },
  };
}
