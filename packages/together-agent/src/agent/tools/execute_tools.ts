import { validateCode } from "./validate_code";
import { ensureToolCallsAreAwaited } from "./transform_code";

// Default execution timeout in milliseconds (30 seconds)
const EXECUTION_TIMEOUT_MS = 30000;

export async function executeTools(
  code: string,
  codeTools: Record<string, any>,
  addJournalEntry?: (title: string, markdown: string) => Promise<void>,
  executionContext: Record<string, any> = {}
) {
  try {
    // Transform code to ensure all tool calls are awaited
    const transformedCode = ensureToolCallsAreAwaited(code);

    // Validate the code before execution
    // Allow codeTools and any keys from executionContext as valid globals
    const allowedGlobals = ["codeTools", ...Object.keys(executionContext)];
    const validation = validateCode(transformedCode, allowedGlobals);
    if (!validation.isValid) {
      return {
        result: undefined,
        error: `Code validation failed:\n${validation.errors.join("\n")}`,
      };
    }

    // Wrap code tools so they can be called directly as functions
    // IMPORTANT: We wrap in anonymous functions to prevent toString() from exposing implementation
    const wrappedCodeTools: Record<string, any> = {};

    // Add addJournalEntry if provided (fire-and-forget tool)
    if (addJournalEntry) {
      wrappedCodeTools.addJournalEntry = addJournalEntry;
    }

    for (const [name, tool] of Object.entries(codeTools)) {
      // Create a wrapper function that hides the original implementation
      const wrapper = async (...args: any[]) => {
        return await tool.execute(...args);
      };

      // Make the tool callable directly
      wrappedCodeTools[name] = wrapper;

      // Also keep the original structure for codeTools.name.execute() pattern
      wrappedCodeTools[name].execute = wrapper;
    }

    // Create the async function with codeTools and executionContext variables in scope
    // Build parameter names list: codeTools plus all executionContext keys
    const paramNames = ["codeTools", ...Object.keys(executionContext)];
    const paramValues = [wrappedCodeTools, ...Object.values(executionContext)];

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
