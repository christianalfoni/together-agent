import { validateCode } from "./validate_code";

export async function executeTools(code: string, tools: Record<string, any>) {
  try {
    // Validate the code before execution
    const validation = validateCode(code);
    if (!validation.isValid) {
      return {
        output: `Code validation failed:\n${validation.errors.join("\n")}`,
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
${code}
      })();`
    );

    // Execute the function with the wrapped tools context
    const result = await asyncFunc(wrappedTools);

    // Return the result as a string
    const output =
      typeof result === "object"
        ? JSON.stringify(result, null, 2)
        : String(result);

    return { output };
  } catch (error: any) {
    return { output: `Error: ${error.message}` };
  }
}
