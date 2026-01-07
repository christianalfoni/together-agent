import { z } from "zod";

export default (context: any) => ({
  description:
    "Send an email message to a recipient. This action requires user approval before sending.",
  inputSchema: z.object({
    to: z.string().describe("Recipient email address"),
    subject: z.string().describe("Email subject line"),
    body: z.string().describe("Email body content"),
  }),
  execute: async ({
    to,
    subject,
    body,
  }: {
    to: string;
    subject: string;
    body: string;
  }) => {
    // Request approval before sending email (throws if rejected)
    await context.requestApproval({
      action: "send_email",
      to,
      subject,
      body,
      warning: "This will send a real email to the recipient",
    });

    // If we get here, approval was granted
    // Simulate sending email (in a real implementation, you'd use an email API)
    console.log(`[SIMULATED] Sending email to ${to}`);
    console.log(`[SIMULATED] Subject: ${subject}`);
    console.log(`[SIMULATED] Body: ${body}`);

    // Simulate some delay
    await new Promise((resolve) => setTimeout(resolve, 500));

    return {
      success: true,
      sent: true,
      to,
      subject,
      timestamp: new Date().toISOString(),
      messageId: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };
  },
});
