import * as acorn from "acorn";
import * as acornJsx from "acorn-jsx";

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  functionName?: string; // The detected widget function name
}

// Base data types that are always allowed
const BASE_ALLOWED_GLOBALS = new Set([
  // Standard JavaScript types
  "Array",
  "Boolean",
  "Date",
  "Error",
  "JSON",
  "Math",
  "Number",
  "Object",
  "String",
  "RegExp",
  "Map",
  "Set",
  "Promise",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "undefined",
  "NaN",
  "Infinity",
]);

// Widget-specific allowed globals
const WIDGET_ALLOWED_GLOBALS = new Set([
  ...BASE_ALLOWED_GLOBALS,
  // Widget rendering
  "h",
  "codeTools",
  // Available components
  "Container",
  "Input",
  "Textarea",
  "Button",
  "Text",
  "Card",
  "Spinner",
  "Alert",
]);

// Dangerous patterns to block
const FORBIDDEN_IDENTIFIERS = new Set([
  "require",
  "import",
  "eval",
  "Function",
  "process",
  "global",
  "globalThis",
  "__dirname",
  "__filename",
  "module",
  "exports",
  "setTimeout",
  "setInterval",
  "setImmediate",
]);

/**
 * Validates widget code for security and structure requirements.
 * Widgets execute in client sandbox, so security model differs from server-side execute_code.
 *
 * This validator supports both JSX source code and transformed code:
 * - For build_widget tool: validates transformed code (after JSX -> h() transformation)
 * - For direct use: can validate JSX source for early validation and better error messages
 *
 * @param code - The widget code to validate (JSX or transformed)
 * @param options - Optional configuration
 * @param options.allowedGlobals - Additional global identifiers to allow (merged with defaults)
 */
export function validateWidgetCode(
  code: string,
  options?: { allowedGlobals?: string[] }
): ValidationResult {
  const errors: string[] = [];

  // Merge custom allowed globals with defaults
  const allowedGlobals = options?.allowedGlobals
    ? new Set([...WIDGET_ALLOWED_GLOBALS, ...options.allowedGlobals])
    : WIDGET_ALLOWED_GLOBALS;

  // 1. Parse code with JSX support
  let ast;
  try {
    const jsx = (acornJsx as any).default || acornJsx;
    const acornWithJsx = acorn.Parser.extend(jsx());
    ast = acornWithJsx.parse(code, {
      ecmaVersion: "latest",
      sourceType: "module",
    });
  } catch (err: any) {
    return {
      isValid: false,
      errors: [`Failed to parse code: ${err.message}`],
    };
  }

  // 2. Security validation - check for forbidden patterns and unknown globals
  // Track declared identifiers in each scope
  const scopeStack: Set<string>[] = [new Set()];

  function pushScope() {
    scopeStack.push(new Set());
  }

  function popScope() {
    scopeStack.pop();
  }

  function declareInScope(name: string) {
    scopeStack[scopeStack.length - 1].add(name);
  }

  function isInScope(name: string): boolean {
    // Check if name is in any scope or allowed globals
    if (allowedGlobals.has(name)) return true;
    for (const scope of scopeStack) {
      if (scope.has(name)) return true;
    }
    return false;
  }

  function walk(node: any, parent: any = null) {
    if (!node || typeof node !== "object") return;

    node.parent = parent;

    // Check for import/export statements
    if (
      node.type === "ImportDeclaration" ||
      node.type === "ExportNamedDeclaration" ||
      node.type === "ExportDefaultDeclaration" ||
      node.type === "ExportAllDeclaration"
    ) {
      errors.push("Import/export statements are not allowed in widgets");
    }

    // Check for forbidden identifiers
    if (node.type === "Identifier" && FORBIDDEN_IDENTIFIERS.has(node.name)) {
      errors.push(
        `Not allowed: '${node.name}' is not available in widget context`
      );
    }

    // Check for while/do-while loops (potential infinite loops)
    if (node.type === "WhileStatement") {
      errors.push(
        "while loops are not allowed (potential infinite loop). Use for loops or array methods instead."
      );
    }

    if (node.type === "DoWhileStatement") {
      errors.push(
        "do-while loops are not allowed (potential infinite loop). Use for loops or array methods instead."
      );
    }

    // Declare function names in parent scope BEFORE creating new scope
    if (node.type === "FunctionDeclaration" && node.id) {
      declareInScope(node.id.name);
    }

    // Track scope for functions and blocks
    let createdScope = false;
    if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression" ||
      node.type === "BlockStatement" ||
      node.type === "ForStatement" ||
      node.type === "ForInStatement" ||
      node.type === "ForOfStatement"
    ) {
      pushScope();
      createdScope = true;
    }

    // Declare function parameters
    if (
      (node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression") &&
      node.params
    ) {
      for (const param of node.params) {
        if (param.type === "Identifier") {
          declareInScope(param.name);
        } else if (param.type === "ObjectPattern") {
          for (const prop of param.properties) {
            if (prop.type === "Property" && prop.value.type === "Identifier") {
              declareInScope(prop.value.name);
            } else if (prop.type === "RestElement" && prop.argument.type === "Identifier") {
              declareInScope(prop.argument.name);
            }
          }
        } else if (param.type === "ArrayPattern") {
          for (const element of param.elements) {
            if (element && element.type === "Identifier") {
              declareInScope(element.name);
            }
          }
        } else if (param.type === "RestElement" && param.argument.type === "Identifier") {
          declareInScope(param.argument.name);
        }
      }
    }

    // Declare variable declarations
    if (node.type === "VariableDeclarator" && node.id) {
      if (node.id.type === "Identifier") {
        declareInScope(node.id.name);
      } else if (node.id.type === "ObjectPattern") {
        for (const prop of node.id.properties) {
          if (prop.type === "Property" && prop.value.type === "Identifier") {
            declareInScope(prop.value.name);
          } else if (prop.type === "RestElement" && prop.argument.type === "Identifier") {
            declareInScope(prop.argument.name);
          }
        }
      } else if (node.id.type === "ArrayPattern") {
        for (const element of node.id.elements) {
          if (element && element.type === "Identifier") {
            declareInScope(element.name);
          }
        }
      }
    }

    // Declare catch clause parameters
    if (node.type === "CatchClause" && node.param) {
      pushScope();
      createdScope = true;
      if (node.param.type === "Identifier") {
        declareInScope(node.param.name);
      }
    }

    // Check for unknown global identifiers
    if (node.type === "Identifier") {
      const parentNode = node.parent;

      // Skip if this identifier is:
      // - A property being accessed (obj.prop) - the 'prop' part
      // - A property key in object literal ({ key: value }) - the 'key' part
      // - Being declared (handled above)
      const isPropertyAccess =
        parentNode?.type === "MemberExpression" &&
        parentNode.property === node &&
        !parentNode.computed;

      const isPropertyKey =
        parentNode?.type === "Property" &&
        parentNode.key === node &&
        !parentNode.computed;

      const isMethodDefinitionKey =
        parentNode?.type === "MethodDefinition" &&
        parentNode.key === node &&
        !parentNode.computed;

      const isBeingDeclared =
        parentNode?.type === "VariableDeclarator" && parentNode.id === node ||
        parentNode?.type === "FunctionDeclaration" && parentNode.id === node ||
        parentNode?.type === "CatchClause" && parentNode.param === node;

      // This is a free variable reference - check if it's allowed
      if (!isPropertyAccess && !isPropertyKey && !isMethodDefinitionKey && !isBeingDeclared) {
        if (!isInScope(node.name)) {
          errors.push(
            `Unknown identifier '${node.name}' is not allowed. Only these globals are available: ${Array.from(allowedGlobals).sort().join(", ")}`
          );
        }
      }
    }

    // Check JSX component names (JSXIdentifier nodes)
    // This supports validating both JSX source and transformed code
    if (node.type === "JSXIdentifier") {
      const parentNode = node.parent;

      // Only validate JSX element names (opening/closing tags), not attribute names
      const isJSXElementName =
        parentNode?.type === "JSXOpeningElement" ||
        parentNode?.type === "JSXClosingElement";

      if (isJSXElementName) {
        // Check for HTML elements (lowercase names)
        if (/^[a-z]/.test(node.name)) {
          errors.push(
            `HTML element '<${node.name}>' is not allowed. Only use the provided components: ${Array.from(allowedGlobals).filter(g => /^[A-Z]/.test(g)).sort().join(", ")}`
          );
        } else if (!isInScope(node.name)) {
          errors.push(
            `Unknown identifier '${node.name}' is not allowed. Only these globals are available: ${Array.from(allowedGlobals).sort().join(", ")}`
          );
        }
      }
    }

    // Recursively walk child nodes
    for (const key in node) {
      if (key === "parent") continue;
      if (node[key] && typeof node[key] === "object") {
        if (Array.isArray(node[key])) {
          node[key].forEach((child: any) => walk(child, node));
        } else {
          walk(node[key], node);
        }
      }
    }

    // Pop scope after processing children
    if (createdScope) {
      popScope();
    }
  }

  walk(ast);

  // Return early if security validation failed
  if (errors.length > 0) {
    return { isValid: false, errors };
  }

  // 3. Check for widget function with correct signature
  let widgetFunctionName: string | null = null;
  let hasCorrectSignature = false;

  function walkForWidget(node: any) {
    if (!node || typeof node !== "object") return;

    // Look for any function declaration with the correct signature
    if (node.type === "FunctionDeclaration" && node.id?.name) {
      // Check signature: FunctionName({ state, setState })
      if (node.params.length === 1 && node.params[0].type === "ObjectPattern") {
        const properties = node.params[0].properties;
        const hasState = properties.some((p: any) => p.key?.name === "state");
        const hasSetState = properties.some(
          (p: any) => p.key?.name === "setState"
        );
        if (hasState && hasSetState) {
          // Found a function with the correct signature
          widgetFunctionName = node.id.name;
          hasCorrectSignature = true;
        }
      }
    }

    // Recursively walk child nodes
    for (const key in node) {
      if (key === "parent") continue; // Skip parent to avoid infinite recursion
      if (node[key] && typeof node[key] === "object") {
        if (Array.isArray(node[key])) {
          node[key].forEach(walkForWidget);
        } else {
          walkForWidget(node[key]);
        }
      }
    }
  }

  walkForWidget(ast);

  if (!widgetFunctionName) {
    errors.push('Code must define a function with signature: function Name({ state, setState })');
  }
  if (!hasCorrectSignature) {
    errors.push("Widget function must accept { state, setState } as parameter");
  }

  // 4. Check for .initialState assignment (using the detected function name)
  if (widgetFunctionName) {
    const initialStatePattern = new RegExp(`${widgetFunctionName}\\.initialState\\s*=`);
    const hasInitialState = initialStatePattern.test(code);
    if (!hasInitialState) {
      errors.push(`Function must define ${widgetFunctionName}.initialState`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    functionName: widgetFunctionName || undefined,
  };
}

export type { ValidationResult };
