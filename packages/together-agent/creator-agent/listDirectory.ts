// @ts-nocheck
import { z } from "zod";
import { tool } from "together-agent";
import fs from "fs/promises";
import path from "path";

export default tool({
  native: true,
  discoveryTerms: [
    "list",
    "directory",
    "folder",
    "ls",
    "dir",
    "contents",
    "files",
    "subdirectories",
    "tree",
    "structure",
    "browse",
    "explore",
  ],
  inputSchema: z.object({
    path: z
      .string()
      .default(".")
      .describe(
        "Directory path to list (relative to workspace, defaults to workspace root)"
      ),
    recursive: z
      .boolean()
      .default(false)
      .describe("Whether to recursively list subdirectories"),
    showHidden: z
      .boolean()
      .default(false)
      .describe("Whether to show hidden files (starting with .)"),
    maxDepth: z
      .number()
      .default(3)
      .describe("Maximum depth for recursive listing"),
  }),
  outputSchema: z.object({
    path: z.string(),
    entries: z.array(
      z.object({
        name: z.string(),
        path: z.string(),
        type: z.enum(["file", "directory", "symlink"]),
        size: z.number().optional(),
        children: z.array(z.any()).optional(),
      })
    ),
    totalFiles: z.number(),
    totalDirectories: z.number(),
  }),
  execute: async (input, context) => {
    const targetPath = path.join(context.workspacePath, input.path);

    console.log(`Listing directory: ${input.path}`);
    if (input.recursive) {
      console.log(`Recursive listing (max depth: ${input.maxDepth})`);
    }

    try {
      // Check if path exists and is a directory
      const stats = await fs.stat(targetPath);
      if (!stats.isDirectory()) {
        throw new Error("Path is not a directory");
      }

      let totalFiles = 0;
      let totalDirectories = 0;

      async function listDir(
        dirPath: string,
        depth: number = 0
      ): Promise<any[]> {
        if (input.recursive && depth >= input.maxDepth) {
          return [];
        }

        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        const result: any[] = [];

        for (const entry of entries) {
          // Skip hidden files unless requested
          if (!input.showHidden && entry.name.startsWith(".")) {
            continue;
          }

          // Skip node_modules for performance
          if (entry.name === "node_modules") {
            continue;
          }

          const fullPath = path.join(dirPath, entry.name);
          const relativePath = path.relative(context.workspacePath, fullPath);

          let entryType: "file" | "directory" | "symlink";
          let size: number | undefined;
          let children: any[] | undefined;

          if (entry.isSymbolicLink()) {
            entryType = "symlink";
          } else if (entry.isDirectory()) {
            entryType = "directory";
            totalDirectories++;

            // Recursively list subdirectories if requested
            if (input.recursive) {
              children = await listDir(fullPath, depth + 1);
            }
          } else {
            entryType = "file";
            totalFiles++;

            // Get file size for files
            try {
              const fileStat = await fs.stat(fullPath);
              size = fileStat.size;
            } catch {
              // If we can't stat the file, just skip the size
            }
          }

          result.push({
            name: entry.name,
            path: relativePath,
            type: entryType,
            size,
            children,
          });
        }

        // Sort: directories first, then files, alphabetically
        return result.sort((a, b) => {
          if (a.type === "directory" && b.type !== "directory") return -1;
          if (a.type !== "directory" && b.type === "directory") return 1;
          return a.name.localeCompare(b.name);
        });
      }

      const entries = await listDir(targetPath);

      console.log(
        `Found ${totalFiles} files and ${totalDirectories} directories`
      );

      return {
        path: input.path,
        entries,
        totalFiles,
        totalDirectories,
      };
    } catch (error: any) {
      if (error.code === "ENOENT") {
        throw new Error(`Directory not found: ${input.path}`);
      }
      throw new Error(`Failed to list directory: ${error.message}`);
    }
  },
});
