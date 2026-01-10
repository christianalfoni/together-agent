import { validateCode } from "./validate_code";
import { ensureToolCallsAreAwaited } from "./transform_code";

// Default execution timeout in milliseconds (30 seconds)
const EXECUTION_TIMEOUT_MS = 30000;

export async function executeTools(code: string, tools: Record<string, any>) {
  try {
    // Transform code to ensure all tool calls are awaited
    const transformedCode = ensureToolCallsAreAwaited(code);

    // Validate the code before execution (console is NOT allowed)
    const validation = validateCode(transformedCode, ["tools"]);
    if (!validation.isValid) {
      return {
        result: undefined,
        error: `Code validation failed:\n${validation.errors.join("\n")}`,
      };
    }

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

    // Create the async function with tools in scope
    const asyncFunc = new Function(
      "tools",
      `return (async () => {
${transformedCode}
      })();`
    );

    // Execute with timeout protection and capture the return value
    const result = await Promise.race([
      asyncFunc(wrappedTools),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Execution timeout: code took longer than ${EXECUTION_TIMEOUT_MS / 1000} seconds`)),
          EXECUTION_TIMEOUT_MS
        )
      ),
    ]);

    // Return the result (should be markdown string from the code)
    return {
      result: result || "",
    };
  } catch (error: any) {
    return {
      result: undefined,
      error: error.message,
    };
  }
}
