import { validateCode } from "./validate_code";
import { ensureToolCallsAreAwaited } from "./transform_code";

// Default execution timeout in milliseconds (30 seconds)
const EXECUTION_TIMEOUT_MS = 30000;

export async function executeTools(
  code: string,
  capabilities: Record<string, any>,
  addJournalEntry?: (title: string, markdown: string) => Promise<void>,
  executionContext: Record<string, any> = {}
) {
  try {
    // Transform code to ensure all capability calls are awaited
    const transformedCode = ensureToolCallsAreAwaited(code);

    // Validate the code before execution
    // Allow capabilities and any keys from executionContext as valid globals
    const allowedGlobals = ["capabilities", ...Object.keys(executionContext)];
    const validation = validateCode(transformedCode, allowedGlobals);
    if (!validation.isValid) {
      return {
        result: undefined,
        error: `Code validation failed:\n${validation.errors.join("\n")}`,
      };
    }

    // Wrap capabilities so they can be called directly as functions
    // IMPORTANT: We wrap in anonymous functions to prevent toString() from exposing implementation
    const wrappedCapabilities: Record<string, any> = {};

    // Add addJournalEntry if provided (fire-and-forget tool)
    if (addJournalEntry) {
      wrappedCapabilities.addJournalEntry = addJournalEntry;
    }

    for (const [name, capability] of Object.entries(capabilities)) {
      // Create a wrapper function that hides the original implementation
      const wrapper = async (...args: any[]) => {
        return await capability.execute(...args);
      };

      // Make the capability callable directly
      wrappedCapabilities[name] = wrapper;

      // Also keep the original structure for capabilities.name.execute() pattern
      wrappedCapabilities[name].execute = wrapper;
    }

    // Create the async function with capabilities and executionContext variables in scope
    // Build parameter names list: capabilities plus all executionContext keys
    const paramNames = ["capabilities", ...Object.keys(executionContext)];
    const paramValues = [wrappedCapabilities, ...Object.values(executionContext)];

    const asyncFunc = new Function(
      ...paramNames,
      `return (async () => {
${transformedCode}
      })();`
    );

    // Execute with timeout protection and capture the return value
    const result = await Promise.race([
      asyncFunc(...paramValues),
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
