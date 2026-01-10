import { google } from "googleapis";
import { tool } from "together-agent";
import { z } from "zod";

// Tool definition for reading Gmail emails
export default tool({
  discoveryTerms: [
    "email",
    "mail",
    "gmail",
    "message",
    "inbox",
    "unread",
    "read",
    "list",
    "query",
    "search",
    "messages",
    "correspondence",
    "letter",
    "communication",
    "retrieve",
    "fetch",
    "get",
    "show",
    "display",
    "view",
    "check",
    "find",
    "examine",
    "review",
  ],
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe(
        'Gmail search query. Examples: "is:unread", "from:john@example.com", "subject:meeting". Leave empty to get all recent emails.'
      ),
    maxResults: z
      .number()
      .min(1)
      .max(50)
      .default(10)
      .describe("Maximum number of emails to return (1-50, default: 10)"),
  }),
  outputSchema: z.object({
    success: z.boolean().describe("Whether the operation was successful"),
    count: z.number().describe("Number of emails returned"),
    query: z.string().optional().describe("The query that was used to search"),
    emails: z
      .array(
        z.object({
          id: z.string().optional().describe("Email message ID"),
          threadId: z.string().optional().describe("Email thread ID"),
          from: z.string().describe("Sender email address"),
          to: z.string().describe("Recipient email address"),
          subject: z.string().describe("Email subject"),
          date: z.string().describe("Email date"),
          snippet: z.string().optional().describe("Email preview snippet"),
          body: z.string().describe("Email body content"),
          labels: z
            .array(z.string())
            .describe("Gmail labels applied to this email"),
        })
      )
      .describe("Array of email objects"),
    message: z.string().optional().describe("Human-readable message"),
  }),
  execute: async (params, context) => {
    const { query = "is:unread", maxResults = 10 } = params;

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

      // List messages matching the query
      const listResponse = await gmail.users.messages.list({
        userId: "me",
        q: query,
        maxResults: maxResults,
      });

      const messages = listResponse.data.messages || [];

      if (messages.length === 0) {
        return {
          success: true,
          count: 0,
          emails: [],
          message: `No emails found matching query: "${query}"`,
        };
      }

      // Fetch details for each message
      const emailDetails = await Promise.all(
        messages.map(async (message) => {
          const details = await gmail.users.messages.get({
            userId: "me",
            id: message.id!,
            format: "full",
          });

          const headers = details.data.payload?.headers || [];
          const getHeader = (name: string) =>
            headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
              ?.value || "";

          // Extract email body
          let body = "";
          const parts = details.data.payload?.parts || [];

          // Try to get plain text body
          const textPart = parts.find((part) => part.mimeType === "text/plain");
          if (textPart?.body?.data) {
            body = Buffer.from(textPart.body.data, "base64").toString("utf-8");
          } else if (details.data.payload?.body?.data) {
            // If no parts, try to get body directly
            body = Buffer.from(
              details.data.payload.body.data,
              "base64"
            ).toString("utf-8");
          } else {
            // Try HTML part as fallback
            const htmlPart = parts.find(
              (part) => part.mimeType === "text/html"
            );
            if (htmlPart?.body?.data) {
              body = Buffer.from(htmlPart.body.data, "base64").toString(
                "utf-8"
              );
              body = `[HTML content] ${body.substring(0, 500)}...`;
            }
          }

          // Get snippet if no body found
          if (!body) {
            body = details.data.snippet || "[No content available]";
          }

          // Truncate long bodies
          if (body.length > 1000) {
            body = body.substring(0, 1000) + "... [truncated]";
          }

          return {
            id: message.id || undefined,
            threadId: details.data.threadId || undefined,
            from: getHeader("from"),
            to: getHeader("to"),
            subject: getHeader("subject"),
            date: getHeader("date"),
            snippet: details.data.snippet || undefined,
            body: body,
            labels: details.data.labelIds || [],
          };
        })
      );

      return {
        success: true,
        count: emailDetails.length,
        query: query,
        emails: emailDetails,
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
          "Insufficient permissions to access Gmail. Please ensure you granted the required scopes during sign-in."
        );
      }

      throw new Error(`Failed to read emails: ${error.message}`);
    }
  },
});
