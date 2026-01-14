import { z } from 'zod';
import { tool } from 'together-agent';
import fs from 'fs/promises';
import path from 'path';

export default tool({
  discoveryTerms: [
    'read',
    'file',
    'content',
    'cat',
    'view',
    'open',
    'show',
    'display',
    'get',
    'load',
    'fetch',
    'retrieve',
    'lines',
    'text',
  ],
  inputSchema: z.object({
    path: z.string().describe('Path to the file (relative to workspace)'),
    startLine: z.number().optional().describe('Starting line number (1-indexed, inclusive)'),
    endLine: z.number().optional().describe('Ending line number (1-indexed, inclusive)'),
    encoding: z.enum(['utf-8', 'ascii', 'base64']).default('utf-8').describe('File encoding'),
  }),
  outputSchema: z.object({
    path: z.string(),
    content: z.string(),
    startLine: z.number().optional(),
    endLine: z.number().optional(),
    lines: z.number().optional(),
    totalLines: z.number().optional(),
    size: z.number(),
    encoding: z.string(),
  }),
  execute: async (input, context) => {
    const filePath = path.join(context.workspacePath, input.path);

    console.log(`Reading file: ${input.path}`);
    if (input.startLine !== undefined || input.endLine !== undefined) {
      console.log(`Lines: ${input.startLine || 1} to ${input.endLine || 'end'}`);
    }

    try {
      // Check if file exists
      const stats = await fs.stat(filePath);

      if (!stats.isFile()) {
        throw new Error('Path is not a file');
      }

      // Read file content
      const content = await fs.readFile(filePath, input.encoding);
      const contentStr = content.toString();

      // If line range specified, extract those lines
      if (input.startLine !== undefined || input.endLine !== undefined) {
        const lines = contentStr.split('\n');
        const start = Math.max(0, (input.startLine || 1) - 1);
        const end = input.endLine !== undefined
          ? Math.min(lines.length, input.endLine)
          : lines.length;

        const selectedLines = lines.slice(start, end);

        return {
          path: input.path,
          content: selectedLines.join('\n'),
          startLine: start + 1,
          endLine: end,
          totalLines: lines.length,
          size: stats.size,
          encoding: input.encoding,
        };
      }

      // Return full file content
      return {
        path: input.path,
        content: contentStr,
        lines: contentStr.split('\n').length,
        size: stats.size,
        encoding: input.encoding,
      };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error(`File not found: ${input.path}`);
      }
      throw new Error(`Failed to read file: ${error.message}`);
    }
  },
});
