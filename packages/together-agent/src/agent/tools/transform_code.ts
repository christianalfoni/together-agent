import * as acorn from "acorn";

/**
 * Transforms code to ensure all capabilities.* calls are awaited
 * This prevents the LLM from forgetting to use await, which could cause
 * approvals to be skipped or capabilities to not complete properly
 */
export function ensureToolCallsAreAwaited(code: string): string {
  try {
    // Wrap code in async function context for parsing
    const wrappedCode = `(async () => {\n${code}\n})()`;

    // Parse the code into an AST
    const ast = acorn.parse(wrappedCode, {
      ecmaVersion: "latest",
      sourceType: "script",
    }) as any;

    // Track positions where we need to insert 'await '
    const insertions: Array<{ pos: number; text: string }> = [];

    // Walk the AST to find capability calls that need await
    function walk(node: any, parent: any = null) {
      if (!node || typeof node !== "object") return;

      // Check if this is a call expression: capabilities.something() or capabilities.something.execute()
      if (node.type === "CallExpression") {
        let isCapabilityCall = false;
        let capabilityCallStart = node.start;

        // Check for capabilities.something() pattern
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.object.type === "Identifier" &&
          node.callee.object.name === "capabilities"
        ) {
          isCapabilityCall = true;
          capabilityCallStart = node.callee.object.start;
        }

        // Check for capabilities.something.execute() pattern
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.object.type === "MemberExpression" &&
          node.callee.object.object.type === "Identifier" &&
          node.callee.object.object.name === "capabilities"
        ) {
          isCapabilityCall = true;
          capabilityCallStart = node.callee.object.object.start;
        }

        // If this is a capability call, check if it's already awaited
        if (isCapabilityCall) {
          const isAwaited = parent && parent.type === "AwaitExpression";

          if (!isAwaited) {
            // Add 'await ' before this capability call
            // Adjust position to account for the wrapper we added
            const adjustedPos = capabilityCallStart - "(async () => {\n".length;
            insertions.push({ pos: adjustedPos, text: "await " });
          }
        }
      }

      // Recursively walk child nodes
      for (const key in node) {
        const child = node[key];
        if (Array.isArray(child)) {
          child.forEach((c) => {
            if (c && typeof c === "object") {
              walk(c, node);
            }
          });
        } else if (child && typeof child === "object") {
          walk(child, node);
        }
      }
    }

    walk(ast);

    // If no insertions needed, return original code
    if (insertions.length === 0) {
      return code;
    }

    // Sort insertions by position (in reverse order so we can insert from end to start)
    insertions.sort((a, b) => b.pos - a.pos);

    // Apply insertions
    let transformedCode = code;
    for (const insertion of insertions) {
      transformedCode =
        transformedCode.slice(0, insertion.pos) +
        insertion.text +
        transformedCode.slice(insertion.pos);
    }

    console.log(
      `🔧 Auto-fixed ${insertions.length} missing await keyword(s) for capability calls`
    );
    return transformedCode;
  } catch (error: any) {
    // If parsing fails, return original code - validation will catch syntax errors later
    console.warn("Failed to transform code for await insertion:", error.message);
    return code;
  }
}
