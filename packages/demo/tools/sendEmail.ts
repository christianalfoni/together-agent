import { google } from 'googleapis';
import { tool } from 'together-agent';
import { z } from 'zod';

// Tool factory pattern - this function receives the context and returns the tool definition
export default tool({
  discoveryTerms: [
    'email',
    'mail',
    'gmail',
    'send',
    'compose',
    'draft',
    'write',
    'message',
    'reply',
    'respond',
    'forward',
    'dispatch',
    'transmit',
    'deliver',
    'communicate',
    'correspondence',
    'letter',
    'note',
    'memo',
    'reach out',
    'contact',
    'notify',
    'inform',
  ],
  inputSchema: z.object({
    to: z
      .string()
      .email()
      .describe('Recipient email address (e.g., john@example.com)'),
    subject: z.string().min(1).describe('Email subject line'),
    body: z.string().min(1).describe('Email message body (plain text)'),
    cc: z
      .string()
      .email()
      .optional()
      .describe('Optional CC email address'),
    bcc: z
      .string()
      .email()
      .optional()
      .describe('Optional BCC email address'),
  }),
  execute: async (params: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
  }, context) => {
    const { to, subject, body, cc, bcc } = params;

    // Request approval before sending
    // This will pause execution and send an approval_request message to the client
    await context.requestApproval({
      action: 'send_email',
      to,
      subject,
      body,
      cc,
      bcc,
      warning:
        'This will send a real email from your Gmail account to the recipient(s).',
    });

    // If we reach here, the user approved the action
    // Get Google access token from secrets
    const accessToken = context.secrets.GOOGLE_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error('Google access token not found. Please sign in again.');
    }

    try {
      // Initialize Google OAuth2 client
      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: accessToken });

      // Create Gmail API client
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

      // Compose email in RFC 2822 format
      const emailLines = [
        `To: ${to}`,
        ...(cc ? [`Cc: ${cc}`] : []),
        ...(bcc ? [`Bcc: ${bcc}`] : []),
        `Subject: ${subject}`,
        'Content-Type: text/plain; charset=utf-8',
        '',
        body,
      ];

      const email = emailLines.join('\r\n');

      // Encode to base64 (URL-safe)
      const base64Email = Buffer.from(email)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      // Send the email
      const sendResponse = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: base64Email,
        },
      });

      return {
        success: true,
        messageId: sendResponse.data.id,
        threadId: sendResponse.data.threadId,
        to,
        subject,
        message: `Email sent successfully to ${to}`,
      };
    } catch (error: any) {
      // Handle specific Gmail API errors
      if (error.code === 401) {
        throw new Error(
          'Google access token expired. Please sign in again to refresh your access.'
        );
      }

      if (error.code === 403) {
        throw new Error(
          'Insufficient permissions to send email. Please ensure you granted the gmail.send scope during sign-in.'
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
