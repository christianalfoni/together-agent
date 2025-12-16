import z from "zod";

type Tool = {
  description?: string;
  inputSchema: z.ZodType<any>;
  execute: (params: any) => Promise<any> | any;
};

export function discoverToolsInMemory(
  query: string,
  tools: Record<string, Tool>
) {
  try {
    const matchedTools = [];
    // Split query into individual words and create regex for each
    const queryWords = query.split(/\s+/).filter(word => word.length > 0);
    const regexes = queryWords.map(word => new RegExp(word, "i"));

    for (const [name, tool] of Object.entries(tools)) {
      // Stringify the schema for searching
      const schemaJson = z.toJSONSchema(tool.inputSchema);
      const schemaString = JSON.stringify(schemaJson);
      const description = tool.description || "";

      // Check if ANY query words match in tool name, description, or schema
      const anyWordMatches = regexes.some(regex =>
        regex.test(name) ||
        regex.test(description) ||
        regex.test(schemaString)
      );

      if (anyWordMatches) {
        matchedTools.push({
          name,
          // Description excluded to save tokens - only schema needed for execution
          schema: schemaJson,
        });
      }
    }

    return { tools: matchedTools };
  } catch {
    return { tools: [] };
  }
}
