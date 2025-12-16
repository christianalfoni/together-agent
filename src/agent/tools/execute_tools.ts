import { validateCode } from "./validate_code";
import { createConsoleInterceptor } from "./console_interceptor";

export async function executeTools(code: string, tools: Record<string, any>) {
  try {
    // Validate the code before execution
    const validation = validateCode(code, ["tools", "console"]);
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
${code}
      })();`
    );

    // Execute the function with the wrapped tools and console context
    const result = await asyncFunc(wrappedTools, mockConsole);

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
