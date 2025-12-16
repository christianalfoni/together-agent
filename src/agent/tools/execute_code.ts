import { validateCode } from "./validate_code";

export async function executeCode(code: string) {
  try {
    // Validate the code before execution (no tools available)
    const validation = validateCode(code, []);
    if (!validation.isValid) {
      return {
        output: `Code validation failed:\n${validation.errors.join("\n")}`,
      };
    }

    // Create the async function
    const asyncFunc = new Function(
      `return (async () => {
${code}
      })();`
    );

    // Execute the function
    const result = await asyncFunc();

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
