import { validateCode } from "./validate_code";
import { createConsoleInterceptor } from "./console_interceptor";

// Default execution timeout in milliseconds (30 seconds)
const EXECUTION_TIMEOUT_MS = 30000;

export async function executeCode(code: string) {
  try {
    // Validate the code before execution (no tools available, but console is allowed)
    const validation = validateCode(code, ["console"]);
    if (!validation.isValid) {
      return {
        logs: [],
        result: undefined,
        error: `Code validation failed:\n${validation.errors.join("\n")}`,
      };
    }

    // Create console interceptor
    const { console: mockConsole, getLogs } = createConsoleInterceptor();

    // Create the async function with console in scope
    const asyncFunc = new Function(
      "console",
      `return (async () => {
${code}
      })();`
    );

    // Execute with timeout protection
    await Promise.race([
      asyncFunc(mockConsole),
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
