import { CodeSandbox } from '@codesandbox/sdk';

export const VERSION = '0.1.0';

interface TogetherAgentSDKOptions {
  apiKey?: string;
}

interface PromptOptions {
  env?: Record<string, string>;
  sessionId?: string;
}

interface PromptResult {
  success: boolean;
  sessionId?: string;
  response?: string;
  error?: string;
  timestamp?: string;
}

interface Agent {
  prompt: (message: string, options?: PromptOptions) => Promise<PromptResult>;
  sandboxId: string;
  url: string;
}

export class TogetherAgentSDK {
  private apiKey: string;

  constructor(options: TogetherAgentSDKOptions = {}) {
    this.apiKey = options.apiKey || process.env.TOGETHER_API_KEY || '';

    if (!this.apiKey) {
      throw new Error('API key is required. Pass it in options or set TOGETHER_API_KEY environment variable.');
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
            env: options.env || {},
            ...(options.sessionId && { sessionId: options.sessionId }),
          };

          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
          });

          if (!response.ok) {
            const text = await response.text();
            throw new Error(`Agent request failed with status ${response.status}: ${text}`);
          }

          return await response.json() as PromptResult;
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
