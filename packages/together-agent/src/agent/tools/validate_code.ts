import * as acorn from "acorn";

interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

// Safe globals that are always allowed
const BASE_ALLOWED_GLOBALS = new Set([
  // Standard JavaScript
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

export function validateCode(
  code: string,
  additionalGlobals: string[] = ["tools"]
): ValidationResult {
  const errors: string[] = [];
  const ALLOWED_GLOBALS = new Set([
    ...BASE_ALLOWED_GLOBALS,
    ...additionalGlobals,
  ]);

  try {
    // Wrap code in async function context for parsing
    // This allows us to parse await expressions properly
    const wrappedCode = `(async () => {\n${code}\n})()`;

    // Parse the code into an AST
    const ast = acorn.parse(wrappedCode, {
      ecmaVersion: "latest",
      sourceType: "script",
    });

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
      if (ALLOWED_GLOBALS.has(name)) return true;
      for (const scope of scopeStack) {
        if (scope.has(name)) return true;
      }
      return false;
    }

    // Walk the AST to check for forbidden patterns
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
        errors.push(`Import statements are not supported. Use tools to access discovered tools instead.`);
      }

      // Check for forbidden identifiers
      if (node.type === "Identifier" && FORBIDDEN_IDENTIFIERS.has(node.name)) {
        if (node.name === "require") {
          errors.push(`'require()' is not supported. Use tools to access discovered tools instead.`);
        } else if (node.name === "import") {
          errors.push(`'import' is not supported. Use tools to access discovered tools instead.`);
        } else {
          errors.push(`Not allowed: '${node.name}' is not available. Use 'tools' to access discovered tools.`);
        }
      }

      // Check for member expressions accessing forbidden globals
      if (
        node.type === "MemberExpression" &&
        node.object.type === "Identifier"
      ) {
        if (FORBIDDEN_IDENTIFIERS.has(node.object.name)) {
          errors.push(`Not allowed: '${node.object.name}' is not available. Use 'tools' to access discovered tools.`);
        }
      }

      // Check for constructor property access chains (e.g., {}.constructor.constructor)
      // This is a common way to get access to the Function constructor
      if (
        node.type === "MemberExpression" &&
        node.property.type === "Identifier" &&
        node.property.name === "constructor"
      ) {
        // Check if this is a nested constructor access (constructor.constructor)
        if (
          node.object.type === "MemberExpression" &&
          node.object.property.type === "Identifier" &&
          node.object.property.name === "constructor"
        ) {
          errors.push(
            "Nested constructor property access is not allowed (potential Function constructor escape)"
          );
        }
      }

      // Block while and do-while loops to prevent infinite loops that block the thread
      // For loops are allowed as they have more structure and termination conditions
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

      // Declare function names
      if (node.type === "FunctionDeclaration" && node.id) {
        declareInScope(node.id.name);
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
        const parent = node.parent;

        // Skip if this identifier is:
        // - A property being accessed (obj.prop) - the 'prop' part
        // - A property key in object literal ({ key: value }) - the 'key' part
        // - Part of a member expression object (we'll check it separately)
        // - Being declared (handled above)
        const isPropertyAccess =
          parent?.type === "MemberExpression" &&
          parent.property === node &&
          !parent.computed;

        const isPropertyKey =
          parent?.type === "Property" &&
          parent.key === node &&
          !parent.computed;

        const isMethodDefinitionKey =
          parent?.type === "MethodDefinition" &&
          parent.key === node &&
          !parent.computed;

        const isBeingDeclared =
          parent?.type === "VariableDeclarator" && parent.id === node ||
          parent?.type === "FunctionDeclaration" && parent.id === node ||
          parent?.type === "CatchClause" && parent.param === node;

        // This is a free variable reference - check if it's allowed
        if (!isPropertyAccess && !isPropertyKey && !isMethodDefinitionKey && !isBeingDeclared) {
          if (!isInScope(node.name)) {
            errors.push(
              `Unknown identifier '${node.name}' is not allowed. Only these globals are available: ${Array.from(ALLOWED_GLOBALS).sort().join(", ")}`
            );
          }
        }
      }

      // Recursively walk child nodes
      for (const key in node) {
        if (key === "parent") continue; // Skip parent references
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

      // Pop scope after processing children
      if (createdScope) {
        popScope();
      }
    }

    walk(ast);

    return {
      isValid: errors.length === 0,
      errors,
    };
  } catch (error: any) {
    return {
      isValid: false,
      errors: [`Failed to parse code: ${error.message}`],
    };
  }
}
