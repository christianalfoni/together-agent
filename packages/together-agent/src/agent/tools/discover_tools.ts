import { z } from "zod";
import { CustomToolDefinition } from "../../index";

export function discoverToolsInMemory(
  query: string,
  tools: Record<string, CustomToolDefinition>
) {
  try {
    const matchedTools: Array<{ name: string; inputSchema: any; outputSchema: any; matchCount: number }> = [];
    // Split query into individual words and create regex for each
    const queryWords = query.split(/\s+/).filter(word => word.length > 0);
    const regexes = queryWords.map(word => new RegExp(word, "i"));

    for (const [name, tool] of Object.entries(tools)) {
      // Convert Zod schemas to JSON Schema and ensure they're fully serializable
      const inputSchemaJson = z.toJSONSchema(tool.inputSchema);
      const outputSchemaJson = z.toJSONSchema(tool.outputSchema);

      // Deep clone via JSON to ensure no circular references or non-serializable data
      const cleanInputSchema = JSON.parse(JSON.stringify(inputSchemaJson));
      const cleanOutputSchema = JSON.parse(JSON.stringify(outputSchemaJson));

      const schemaString = JSON.stringify(cleanInputSchema) + JSON.stringify(cleanOutputSchema);

      // Join discovery terms for searching
      const discoveryTermsString = tool.discoveryTerms.join(" ");

      // Count how many query words match in tool name, discoveryTerms, or schemas
      let matchCount = 0;
      for (const regex of regexes) {
        if (regex.test(name) || regex.test(discoveryTermsString) || regex.test(schemaString)) {
          matchCount++;
        }
      }

      if (matchCount > 0) {
        matchedTools.push({
          name,
          inputSchema: cleanInputSchema,
          outputSchema: cleanOutputSchema,
          matchCount,
        });
      }
    }

    // Sort by match count (highest first)
    matchedTools.sort((a, b) => b.matchCount - a.matchCount);

    // Remove matchCount before returning (internal scoring only)
    const sortedTools = matchedTools.map(({ name, inputSchema, outputSchema }) => ({
      name,
      inputSchema,
      outputSchema
    }));

    return { tools: sortedTools };
  } catch (err) {
    console.error("ERROR in discoverToolsInMemory:", err);
    return { tools: [] };
  }
}
