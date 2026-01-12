import PDFDocument from 'pdfkit';
import { tool } from 'together-agent';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

export default tool({
  discoveryTerms: [
    'pdf',
    'generate',
    'create',
    'document',
    'export',
    'convert',
    'format',
    'save',
    'download',
    'compose',
    'write',
    'produce',
    'make',
    'build',
    'output',
  ],
  inputSchema: z.object({
    text: z.string().min(1).describe('The text content to include in the PDF'),
    filename: z
      .string()
      .min(1)
      .describe('The name of the PDF file (e.g., "document.pdf")'),
    title: z
      .string()
      .optional()
      .describe('Optional title to display at the top of the PDF'),
    fontSize: z
      .number()
      .min(8)
      .max(72)
      .optional()
      .default(12)
      .describe('Font size for the body text (default: 12)'),
  }),
  outputSchema: z.object({
    success: z.boolean().describe('Whether the PDF was generated successfully'),
    filePath: z.string().describe('Full path to the generated PDF file'),
    filename: z.string().describe('Name of the PDF file'),
    size: z.number().describe('File size in bytes'),
    message: z.string().describe('Human-readable success message'),
  }),
  execute: async (
    params: {
      text: string;
      filename: string;
      title?: string;
      fontSize?: number;
    },
    context
  ) => {
    const { text, filename, title, fontSize = 12 } = params;

    // Ensure filename ends with .pdf
    const pdfFilename = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;

    // Get workspace path from context
    const workspacePath = context.workspacePath || process.cwd();
    const outputPath = path.join(workspacePath, pdfFilename);

    try {
      // Create a new PDF document
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: {
          top: 50,
          bottom: 50,
          left: 50,
          right: 50,
        },
      });

      // Create write stream
      const stream = fs.createWriteStream(outputPath);

      // Pipe the PDF to the file
      doc.pipe(stream);

      // Add title if provided
      if (title) {
        doc.fontSize(18).font('Helvetica-Bold').text(title, {
          align: 'center',
        });
        doc.moveDown(1.5);
      }

      // Add the main text content
      doc.fontSize(fontSize).font('Helvetica').text(text, {
        align: 'left',
        lineGap: 5,
      });

      // Finalize the PDF
      doc.end();

      // Wait for the stream to finish
      await new Promise<void>((resolve, reject) => {
        stream.on('finish', resolve);
        stream.on('error', reject);
      });

      // Get file stats for size
      const stats = fs.statSync(outputPath);

      return {
        success: true,
        filePath: outputPath,
        filename: pdfFilename,
        size: stats.size,
        message: `PDF "${pdfFilename}" generated successfully`,
      };
    } catch (error: any) {
      throw new Error(`Failed to generate PDF: ${error.message}`);
    }
  },
});
