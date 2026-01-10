import { validateCode } from "./validate_code";

// Default execution timeout in milliseconds (30 seconds)
const EXECUTION_TIMEOUT_MS = 30000;

export async function executeCode(code: string) {
  try {
    // Validate the code before execution (no tools available, console is NOT allowed)
    const validation = validateCode(code, []);
    if (!validation.isValid) {
      return {
        result: undefined,
        error: `Code validation failed:\n${validation.errors.join("\n")}`,
      };
    }

    // Create the async function - no console in scope
    const asyncFunc = new Function(
      `return (async () => {
${code}
      })();`
    );

    // Execute with timeout protection and capture the return value
    const result = await Promise.race([
      asyncFunc(),
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
