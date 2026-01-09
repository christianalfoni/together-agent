import { CodeSandbox } from "@codesandbox/sdk";
import { ToolExecutionContext } from "./agent/types";
import { z } from "zod";

export { ToolExecutionContext };

/**
 * Custom tool definition for together-agent
 */
export interface CustomToolDefinition<INPUT = any, RESULT = any> {
  /**
   * Terms used for tool discovery - helps the agent find this tool based on user intent
   */
  discoveryTerms: string[];

  /**
   * Zod schema defining the input parameters for this tool
   */
  inputSchema: z.ZodType<INPUT>;

  /**
   * Execute function that performs the tool's action
   * @param input - The validated input parameters
   * @param context - Tool execution context with secrets and approval methods
   * @returns The result of the tool execution
   */
  execute: (input: INPUT, context: ToolExecutionContext) => Promise<RESULT>;
}

/**
 * Creates a custom tool that can be used with together-agent
 * Returns a function that accepts context and returns the tool definition
 */
export function tool<INPUT = any, RESULT = any>(
  toolDefinition: CustomToolDefinition<INPUT, RESULT>
): (context: ToolExecutionContext) => CustomToolDefinition<INPUT, RESULT> {
  return (context: ToolExecutionContext) => {
    return {
      discoveryTerms: toolDefinition.discoveryTerms,
      inputSchema: toolDefinition.inputSchema,
      execute: (input: INPUT) => toolDefinition.execute(input, context),
    };
  };
}

export const VERSION = "0.1.0";

interface TogetherAgentSDKOptions {
  apiKey?: string;
}

interface PromptOptions {
  secrets?: Record<string, string>;
}

interface Agent {
  prompt: (message: string, options?: PromptOptions) => Promise<Response>;
  approve: (approvalId: string) => Promise<void>;
  reject: (approvalId: string) => Promise<void>;
  sandboxId: string;
  url: string;
}

export class TogetherAgentSDK {
  private apiKey: string;

  constructor(options: TogetherAgentSDKOptions = {}) {
    this.apiKey = options.apiKey || process.env.TOGETHER_API_KEY || "";

    if (!this.apiKey) {
      throw new Error(
        "API key is required. Pass it in options or set TOGETHER_API_KEY environment variable."
      );
    }
  }

  async createAgent(templateId: string): Promise<Agent> {
    // Set the CSB_API_KEY to the Together API key
    // The user mentioned that CodeSandbox SDK supports Together API keys
    const originalCsbKey = process.env.CSB_API_KEY;
    process.env.CSB_API_KEY = this.apiKey;

    try {
      const sdk = new CodeSandbox();

      // Create a sandbox from the template
      const sandbox = await sdk.sandboxes.create({
        id: templateId,
      });

      const sandboxId = sandbox.id;
      const url = `https://${sandboxId}-3000.csb.app/prompt`;

      // Create the agent object with prompt method
      const agent: Agent = {
        sandboxId,
        url,
        prompt: async (message: string, options: PromptOptions = {}) => {
          const payload = {
            prompt: message,
            apiKey: this.apiKey,
            secrets: options.secrets || {},
          };

          const response = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          });

          if (!response.ok) {
            const text = await response.text();
            throw new Error(
              `Agent request failed with status ${response.status}: ${text}`
            );
          }

          // Return the response object so caller can handle SSE stream
          return response;
        },
        approve: async (approvalId: string) => {
          const approvalUrl = `${url}/approval`;

          const response = await fetch(approvalUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              approvalId,
              approved: true,
            }),
          });

          if (!response.ok) {
            const text = await response.text();
            throw new Error(
              `Approval request failed with status ${response.status}: ${text}`
            );
          }
        },
        reject: async (approvalId: string) => {
          const approvalUrl = `${url}/approval`;

          const response = await fetch(approvalUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              approvalId,
              approved: false,
            }),
          });

          if (!response.ok) {
            const text = await response.text();
            throw new Error(
              `Rejection request failed with status ${response.status}: ${text}`
            );
          }
        },
      };

      return agent;
    } finally {
      // Restore original CSB_API_KEY
      if (originalCsbKey !== undefined) {
        process.env.CSB_API_KEY = originalCsbKey;
      } else {
        delete process.env.CSB_API_KEY;
      }
    }
  }
}
