// @ts-nocheck
import { z } from "zod";
import { tool } from "together-agent";
import fg from "fast-glob";
import path from "path";

export default tool({
  native: true,
  discoveryTerms: [
    "code",
    "find",
    "files",
    "search",
    "locate",
    "glob",
    "pattern",
    "match",
    "list",
    "directory",
    "folder",
    "path",
    "extension",
    "wildcard",
  ],
  inputSchema: z.object({
    pattern: z
      .string()
      .describe(
        'Glob pattern to match files (e.g., "**/*.ts", "src/**/*.tsx", "*.json")'
      ),
    cwd: z
      .string()
      .optional()
      .describe(
        "Directory to search in (relative to workspace, defaults to workspace root)"
      ),
    ignoreNodeModules: z
      .boolean()
      .default(true)
      .describe("Whether to ignore node_modules directory"),
  }),
  outputSchema: z.object({
    pattern: z.string(),
    count: z.number(),
    files: z.array(
      z.object({
        path: z.string(),
        absolutePath: z.string(),
      })
    ),
  }),
  execute: async (input, context) => {
    const searchDir = input.cwd
      ? path.join(context.workspacePath, input.cwd)
      : context.workspacePath;

    console.log(`Finding files matching: ${input.pattern}`);
    console.log(`Search directory: ${searchDir}`);

    try {
      const files = await fg(input.pattern, {
        cwd: searchDir,
        ignore: input.ignoreNodeModules ? ["**/node_modules/**"] : [],
        onlyFiles: true,
        absolute: false,
      });

      console.log(`Found ${files.length} matching files`);

      return {
        pattern: input.pattern,
        count: files.length,
        files: files.map((file) => ({
          path: input.cwd ? path.join(input.cwd, file) : file,
          absolutePath: path.join(searchDir, file),
        })),
      };
    } catch (error: any) {
      throw new Error(`Failed to find files: ${error.message}`);
    }
  },
});
