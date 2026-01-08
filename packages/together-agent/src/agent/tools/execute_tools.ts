import { validateCode } from "./validate_code";
import { createConsoleInterceptor } from "./console_interceptor";
import { ensureToolCallsAreAwaited } from "./transform_code";

// Default execution timeout in milliseconds (30 seconds)
const EXECUTION_TIMEOUT_MS = 30000;

export async function executeTools(code: string, tools: Record<string, any>) {
  try {
    // Transform code to ensure all tool calls are awaited
    const transformedCode = ensureToolCallsAreAwaited(code);

    // Validate the code before execution
    const validation = validateCode(transformedCode, ["tools", "console"]);
    if (!validation.isValid) {
      return {
        logs: [],
        result: undefined,
        error: `Code validation failed:\n${validation.errors.join("\n")}`,
      };
    }

    // Create console interceptor
    const { console: mockConsole, getLogs } = createConsoleInterceptor();

    // Wrap tools so they can be called directly as functions
    // IMPORTANT: We wrap in anonymous functions to prevent toString() from exposing implementation
    const wrappedTools: Record<string, any> = {};
    for (const [name, tool] of Object.entries(tools)) {
      // Create a wrapper function that hides the original implementation
      const wrapper = async (...args: any[]) => {
        return await tool.execute(...args);
      };

      // Make the tool callable directly
      wrappedTools[name] = wrapper;

      // Also keep the original structure for tools.name.execute() pattern
      wrappedTools[name].execute = wrapper;
    }

    // Create the async function with tools and console in scope
    const asyncFunc = new Function(
      "tools",
      "console",
      `return (async () => {
${transformedCode}
      })();`
    );

    // Execute with timeout protection
    await Promise.race([
      asyncFunc(wrappedTools, mockConsole),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Execution timeout: code took longer than ${EXECUTION_TIMEOUT_MS / 1000} seconds`)),
          EXECUTION_TIMEOUT_MS
        )
      ),
    ]);

    // Return logs and result
    return {
      logs: getLogs(),
    };
  } catch (error: any) {
    return {
      logs: [],
      result: undefined,
      error: error.message,
    };
  }
}
