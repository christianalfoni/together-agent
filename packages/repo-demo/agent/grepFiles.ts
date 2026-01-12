import { z } from "zod";
import { tool } from "together-agent";
import fg from "fast-glob";
import fs from "fs/promises";
import path from "path";

export default tool({
  discoveryTerms: [
    "code",
    "grep",
    "search",
    "find",
    "text",
    "content",
    "match",
    "pattern",
    "regex",
    "string",
    "keyword",
    "occurrence",
    "contains",
    "includes",
  ],
  inputSchema: z.object({
    pattern: z
      .string()
      .describe("Text or regex pattern to search for in file contents"),
    filePattern: z
      .string()
      .default("**/*")
      .describe(
        'Glob pattern to filter which files to search (e.g., "**/*.ts")'
      ),
    cwd: z
      .string()
      .optional()
      .describe("Directory to search in (relative to workspace)"),
    contextLines: z
      .number()
      .default(2)
      .describe("Number of lines to show before and after each match"),
    caseSensitive: z
      .boolean()
      .default(false)
      .describe("Whether the search should be case-sensitive"),
    maxMatches: z
      .number()
      .default(50)
      .describe("Maximum number of matches to return"),
  }),
  outputSchema: z.object({
    pattern: z.string(),
    filePattern: z.string(),
    matchCount: z.number(),
    matches: z.array(
      z.object({
        file: z.string(),
        line: z.number(),
        column: z.number(),
        match: z.string(),
        context: z.object({
          before: z.array(z.string()),
          matched: z.string(),
          after: z.array(z.string()),
        }),
      })
    ),
    truncated: z.boolean(),
  }),
  execute: async (input, context) => {
    const searchDir = input.cwd
      ? path.join(context.workspacePath, input.cwd)
      : context.workspacePath;

    try {
      // Find all files matching the pattern
      const files = await fg(input.filePattern, {
        cwd: searchDir,
        ignore: ["**/node_modules/**", "**/.git/**"],
        onlyFiles: true,
        absolute: true,
      });

      const regex = new RegExp(input.pattern, input.caseSensitive ? "g" : "gi");

      const matches: Array<{
        file: string;
        line: number;
        column: number;
        match: string;
        context: {
          before: string[];
          matched: string;
          after: string[];
        };
      }> = [];

      // Search each file
      for (const file of files) {
        if (matches.length >= input.maxMatches) break;

        try {
          const content = await fs.readFile(file, "utf-8");
          const lines = content.split("\n");

          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= input.maxMatches) break;

            const line = lines[i];
            const match = line.match(regex);

            if (match) {
              const relativePath = path.relative(context.workspacePath, file);

              matches.push({
                file: relativePath,
                line: i + 1,
                column: match.index || 0,
                match: match[0],
                context: {
                  before: lines.slice(Math.max(0, i - input.contextLines), i),
                  matched: line,
                  after: lines.slice(
                    i + 1,
                    Math.min(lines.length, i + 1 + input.contextLines)
                  ),
                },
              });
            }
          }
        } catch (err) {
          // Skip files that can't be read (binary files, permission issues, etc.)
          continue;
        }
      }

      return {
        pattern: input.pattern,
        filePattern: input.filePattern,
        matchCount: matches.length,
        matches,
        truncated: matches.length >= input.maxMatches,
      };
    } catch (error: any) {
      throw new Error(`Failed to search files: ${error.message}`);
    }
  },
});
