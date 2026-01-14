import { z } from "zod";
import { tool } from "together-agent";
import fs from "fs/promises";
import path from "path";

export default tool({
  discoveryTerms: [
    "code",
    "write",
    "edit",
    "file",
    "change",
    "modify",
    "update",
    "replace",
    "text",
    "content",
  ],
  inputSchema: z.object({
    path: z
      .string()
      .describe("Path to the file to edit (relative to workspace)"),
    oldContent: z
      .string()
      .describe(
        "The exact existing content to replace. Must match the current file content exactly, including whitespace and indentation. Include 3-5 lines of surrounding context for accurate matching."
      ),
    newContent: z
      .string()
      .describe(
        "The new content to replace the old content with. Should maintain consistent indentation and formatting with the rest of the file."
      ),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    path: z.string(),
  }),
  execute: async (input, context) => {
    const filePath = path.join(context.workspacePath, input.path);

    console.log(`Editing file: ${input.path}`);
    console.log(
      `Replacing ${input.oldContent.length} characters with ${input.newContent.length} characters`
    );

    try {
      // Read the current file content
      const currentContent = await fs.readFile(filePath, "utf-8");

      // Check if old content exists in file
      if (!currentContent.includes(input.oldContent)) {
        throw new Error(
          `Content not found in file. The old content must match exactly.\n\n` +
            `Looking for (first 200 chars):\n${input.oldContent.substring(
              0,
              200
            )}...\n\n` +
            `File content (first 200 chars):\n${currentContent.substring(
              0,
              200
            )}...`
        );
      }

      // Count occurrences
      const occurrences = currentContent.split(input.oldContent).length - 1;

      if (occurrences > 1) {
        throw new Error(
          `Found ${occurrences} matches in file. Please provide more context in oldContent to make it unique.`
        );
      }

      // Create the new file content
      const newFileContent = currentContent.replace(
        input.oldContent,
        input.newContent
      );

      // Write back to file
      await fs.writeFile(filePath, newFileContent, "utf-8");

      const message = `Successfully edited ${input.path}`;
      console.log(message);

      return {
        success: true,
        message,
        path: input.path,
      };
    } catch (error: any) {
      if (error.code === "ENOENT") {
        throw new Error(`File not found: ${input.path}`);
      }
      throw new Error(`Failed to edit file: ${error.message}`);
    }
  },
});
