import { z } from 'zod';
import { capability } from 'together-agent';
import fs from 'fs/promises';
import path from 'path';

export default capability({
  discoveryTerms: [
    'write',
    'create',
    'file',
    'save',
    'store',
    'content',
    'text',
    'make',
    'generate',
    'output',
    'new',
    'add',
  ],
  inputSchema: z.object({
    path: z.string().describe('Path to the file (relative to workspace)'),
    content: z.string().describe('Content to write to the file'),
    encoding: z.enum(['utf-8', 'ascii', 'base64']).default('utf-8').describe('File encoding'),
    createDirs: z.boolean().default(true).describe('Create parent directories if they don\'t exist'),
  }),
  outputSchema: z.object({
    path: z.string(),
    size: z.number(),
    lines: z.number(),
    created: z.boolean(),
    message: z.string(),
  }),
  execute: async (input, context) => {
    const filePath = path.join(context.workspacePath, input.path);

    console.log(`Writing file: ${input.path}`);
    console.log(`Content size: ${input.content.length} bytes`);

    try {
      // Check if file already exists
      let existed = true;
      try {
        await fs.access(filePath);
      } catch (error) {
        existed = false;
      }

      // Create parent directories if needed
      if (input.createDirs) {
        const directory = path.dirname(filePath);
        await fs.mkdir(directory, { recursive: true });
      }

      // Write the file
      await fs.writeFile(filePath, input.content, input.encoding);

      // Get file stats
      const stats = await fs.stat(filePath);
      const lines = input.content.split('\n').length;

      const message = existed
        ? `File updated: ${input.path}`
        : `File created: ${input.path}`;

      console.log(message);

      return {
        path: input.path,
        size: stats.size,
        lines,
        created: !existed,
        message,
      };
    } catch (error: any) {
      if (error.code === 'ENOENT' && !input.createDirs) {
        throw new Error(`Directory does not exist for: ${input.path}. Set createDirs to true to create parent directories.`);
      }
      throw new Error(`Failed to write file: ${error.message}`);
    }
  },
});
