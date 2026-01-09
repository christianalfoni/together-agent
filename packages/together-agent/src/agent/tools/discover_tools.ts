import z from "zod";
import { CustomToolDefinition } from "../../index";

export function discoverToolsInMemory(
  query: string,
  tools: Record<string, CustomToolDefinition>
) {
  try {
    const matchedTools: Array<{ name: string; schema: any; matchCount: number }> = [];
    // Split query into individual words and create regex for each
    const queryWords = query.split(/\s+/).filter(word => word.length > 0);
    const regexes = queryWords.map(word => new RegExp(word, "i"));

    for (const [name, tool] of Object.entries(tools)) {
      // Stringify the schema for searching
      const schemaJson = z.toJSONSchema(tool.inputSchema);
      const schemaString = JSON.stringify(schemaJson);

      // Join discovery terms for searching
      const discoveryTermsString = tool.discoveryTerms.join(" ");

      // Count how many query words match in tool name, discoveryTerms, or schema
      let matchCount = 0;
      for (const regex of regexes) {
        if (regex.test(name) || regex.test(discoveryTermsString) || regex.test(schemaString)) {
          matchCount++;
        }
      }

      if (matchCount > 0) {
        matchedTools.push({
          name,
          // Description excluded to save tokens - only schema needed for execution
          schema: schemaJson,
          matchCount,
        });
      }
    }

    // Sort by match count (highest first)
    matchedTools.sort((a, b) => b.matchCount - a.matchCount);

    // Remove matchCount before returning (internal scoring only)
    const sortedTools = matchedTools.map(({ name, schema }) => ({ name, schema }));

    return { tools: sortedTools };
  } catch {
    return { tools: [] };
  }
}
