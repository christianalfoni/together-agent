import { google } from "googleapis";
import { tool } from "together-agent";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";

// Tool factory pattern - this function receives the context and returns the tool definition
export default tool({
  discoveryTerms: [
    "email",
    "mail",
    "gmail",
    "send",
    "compose",
    "draft",
    "write",
    "message",
    "reply",
    "respond",
    "forward",
    "dispatch",
    "transmit",
    "deliver",
    "communicate",
    "correspondence",
    "letter",
    "note",
    "memo",
    "reach out",
    "contact",
    "notify",
    "inform",
  ],
  inputSchema: z.object({
    to: z
      .string()
      .email()
      .describe("Recipient email address (e.g., john@example.com)"),
    subject: z.string().min(1).describe("Email subject line"),
    body: z.string().min(1).describe("Email message body (plain text)"),
    cc: z.string().email().optional().describe("Optional CC email address"),
    bcc: z.string().email().optional().describe("Optional BCC email address"),
    attachments: z
      .array(z.string())
      .optional()
      .describe(
        "Optional array of file paths in workspace to attach (e.g., ['document.pdf', 'image.jpg'])"
      ),
  }),
  outputSchema: z.object({
    success: z.boolean().describe("Whether the email was sent successfully"),
    messageId: z.string().optional().describe("Gmail message ID"),
    threadId: z.string().optional().describe("Gmail thread ID"),
    to: z.string().describe("Recipient email address"),
    subject: z.string().describe("Email subject"),
    message: z.string().describe("Human-readable success message"),
  }),
  execute: async (
    params: {
      to: string;
      subject: string;
      body: string;
      cc?: string;
      bcc?: string;
      attachments?: string[];
    },
    context
  ) => {
    const { to, subject, body, cc, bcc, attachments } = params;

    // Request approval before sending
    // This will pause execution and send an approval_request message to the client
    await context.requestApproval({
      action: "send_email",
      to,
      subject,
      body,
      cc,
      bcc,
      attachments: attachments?.join(", "),
      warning:
        "This will send a real email from your Gmail account to the recipient(s).",
    });

    // If we reach here, the user approved the action
    // Get Google access token from secrets
    const accessToken = context.secrets.GOOGLE_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error("Google access token not found. Please sign in again.");
    }

    try {
      // Initialize Google OAuth2 client
      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: accessToken });

      // Create Gmail API client
      const gmail = google.gmail({ version: "v1", auth: oauth2Client });

      // Read attachment files from workspace if provided
      const attachmentData: Array<{ filename: string; content: Buffer }> = [];
      if (attachments && attachments.length > 0) {
        for (const filePath of attachments) {
          try {
            const fullPath = path.join(context.workspacePath, filePath);
            const fileBuffer = await fs.promises.readFile(fullPath);
            const filename = path.basename(filePath);
            attachmentData.push({ filename, content: fileBuffer });
          } catch (error: any) {
            throw new Error(
              `Failed to read attachment file "${filePath}": ${error.message}`
            );
          }
        }
      }

      // Compose email - use multipart if attachments, otherwise plain text
      let email: string;

      if (attachmentData.length > 0) {
        // Construct multipart MIME message with attachments
        const boundary = `boundary_${Date.now()}_${Math.random().toString(36).substring(2)}`;

        const emailLines = [
          `To: ${to}`,
          ...(cc ? [`Cc: ${cc}`] : []),
          ...(bcc ? [`Bcc: ${bcc}`] : []),
          `Subject: ${subject}`,
          "MIME-Version: 1.0",
          `Content-Type: multipart/mixed; boundary="${boundary}"`,
          "",
          `--${boundary}`,
          "Content-Type: text/plain; charset=utf-8",
          "",
          body,
          "",
        ];

        // Add each attachment
        for (const { filename, content } of attachmentData) {
          const base64Content = content.toString("base64");
          emailLines.push(
            `--${boundary}`,
            `Content-Type: application/octet-stream; name="${filename}"`,
            `Content-Disposition: attachment; filename="${filename}"`,
            "Content-Transfer-Encoding: base64",
            "",
            base64Content,
            ""
          );
        }

        emailLines.push(`--${boundary}--`);
        email = emailLines.join("\r\n");
      } else {
        // Simple plain text email (backward compatible)
        const emailLines = [
          `To: ${to}`,
          ...(cc ? [`Cc: ${cc}`] : []),
          ...(bcc ? [`Bcc: ${bcc}`] : []),
          `Subject: ${subject}`,
          "Content-Type: text/plain; charset=utf-8",
          "",
          body,
        ];
        email = emailLines.join("\r\n");
      }

      // Encode to base64 (URL-safe)
      const base64Email = Buffer.from(email)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      // Send the email
      const sendResponse = await gmail.users.messages.send({
        userId: "me",
        requestBody: {
          raw: base64Email,
        },
      });

      return {
        success: true,
        messageId: sendResponse.data.id || undefined,
        threadId: sendResponse.data.threadId || undefined,
        to,
        subject,
        message: `Email sent successfully to ${to}${
          attachmentData.length > 0
            ? ` with ${attachmentData.length} attachment${attachmentData.length > 1 ? "s" : ""}`
            : ""
        }`,
      };
    } catch (error: any) {
      // Handle specific Gmail API errors
      if (error.code === 401) {
        throw new Error(
          "Google access token expired. Please sign in again to refresh your access."
        );
      }

      if (error.code === 403) {
        throw new Error(
          "Insufficient permissions to send email. Please ensure you granted the gmail.send scope during sign-in."
        );
      }

      if (error.code === 400) {
        throw new Error(
          `Invalid email format: ${error.message}. Please check the recipient address and try again.`
        );
      }

      throw new Error(`Failed to send email: ${error.message}`);
    }
  },
});
