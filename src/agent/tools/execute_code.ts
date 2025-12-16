import { validateCode } from "./validate_code";
import { createConsoleInterceptor } from "./console_interceptor";

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

    // Execute the function with console context
    const result = await asyncFunc(mockConsole);

    // Return logs and result
    return {
      logs: getLogs(),
      result: result,
    };
  } catch (error: any) {
    return {
      logs: [],
      result: undefined,
      error: error.message,
    };
  }
}
