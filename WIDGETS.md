# Widget System Implementation Plan

## Overview

A new native tool `build_widget` that allows the LLM to create interactive UI widgets using JSX syntax. The SDK handles validation and transformation (JSX → h() calls), then sends the transformed code to the client. Client-side rendering is handled separately.

## Architecture Flow

```
LLM writes JSX widget code (function Widget() {...} with Widget.initialState)
    ↓
Server: Validate code (security, structure)
    ↓
Server: Transform JSX → h(component, props, children) calls
        Append "return Widget;" to the transformed code
    ↓
Server: Send widget_created message to client with transformed code
    ↓
Server: Provide /code-tool endpoint for widget tool execution (with secrets & approvals)
    ↓
Client: Executes code with new Function() to get Widget function
Client: Extracts initialState from Widget.initialState
Client: Renders widget with state management
Client: Proxies codeTools calls to server's /code-tool endpoint
```

## Example Widget Code

**LLM writes:**

```javascript
function Widget({ state, setState }) {
  return (
    <Container>
      <Input
        value={state.name}
        onChange={(val) => setState({ name: val })}
        placeholder="Enter your name"
      />
      <Button onClick={() => codeTools.sendEmail(state.name)}>
        Send Email
      </Button>
    </Container>
  );
}

Widget.initialState = { name: "" };
```

**Server transforms to:**

```javascript
function Widget({ state, setState }) {
  return h(
    Container,
    null,
    h(Input, {
      value: state.name,
      onChange: (val) => setState({ name: val }),
      placeholder: "Enter your name",
    }),
    h(
      Button,
      {
        onClick: () => codeTools.sendEmail(state.name),
      },
      "Send Email"
    )
  );
}

Widget.initialState = { name: "" };

return Widget;
```

**Server sends message:**

```json
{
  "type": "widget_created",
  "widgetId": "widget-1234567-abc",
  "code": "function Widget(...) { return h(Container, null, ...) }"
}
```

## SDK Implementation (Server-Side Only)

### New Files to Create

1. **`packages/together-agent/src/agent/tools/transform_jsx.ts`**

   - JSX → h() transformation using acorn-jsx parser
   - Handle: elements, self-closing tags, props (string/expression), children, text nodes
   - After transformation append `return Widget` to the code as this will be used with `Function` in the client
   - Return transformed code string

2. **`packages/together-agent/src/agent/tools/validate_widget.ts`**

   - Extends existing `validateCode()` with widget-specific rules
   - Required structure:
     - Must define function named `Widget` (no export required)
     - Widget must accept `{ state, setState }` signature
     - Must define `Widget.initialState` property
   - Security checks (reuse existing):
     - No eval, require, import, Function, process, global, setTimeout
     - No nested constructor access
     - No while/do-while loops
   - Allowed globals: state, setState, h, codeTools, component names

3. **`packages/together-agent/src/agent/tools/build_widget.ts`**
   - Main tool definition
   - Orchestrates: validate → transform → send message
   - Returns: `{ success: true, widgetId }`

### Test Files to Create

4. **`packages/together-agent/src/agent/tools/__tests__/transform_jsx.test.ts`**
   - Comprehensive tests for JSX transformation
   - Tests for all JSX patterns: elements, props, children, nested structures
   - Tests for JSX in expressions (map, filter, etc.)
   - Edge cases and error handling

5. **`packages/together-agent/src/agent/tools/__tests__/validate_widget.test.ts`**
   - Tests for widget validation logic
   - Tests for structure requirements (Widget function, signature, initialState)
   - Tests for security checks (dangerous code patterns)
   - Tests for edge cases

### Files to Modify

6. **`packages/together-agent/src/agent/types.ts`**

   - Add `WidgetCreatedMessage` interface to AgentMessage union:
     ```typescript
     export interface WidgetCreatedMessage {
       type: "widget_created";
       widgetId: string;
       code: string; // Transformed code with h() calls and Widget.initialState accessible
     }
     ```

7. **`packages/together-agent/src/agent/routes.ts`**

   - Add POST `/code-tool` endpoint for widget tool execution
   - Load tools, find requested tool, execute, return result
   - This endpoint accepts `secrets` in the request body for tool execution context
   - The code tools context works the same way, including approval mechanism
   - Approvals are handled via `requiresApproval` response flag and `approvalToken` in request
   - Integrate `build_widget` tool into main agent route

8. **`packages/together-agent/package.json`**
   - Add dependency: `acorn-jsx@^5.3.2`
   - Add dev dependency: `vitest@^2.0.0`
   - Add test script: `"test": "vitest"`

9. **`packages/together-agent/vitest.config.ts`**
   - Create vitest configuration file for running tests
   - Configure TypeScript support and test file patterns

## Implementation Details

### 1. JSX Transformation (transform_jsx.ts)

**Core logic:**

```typescript
import * as acornJsx from "acorn-jsx";

export function transformJSXToH(code: string): string {
  // 1. Parse code with JSX support
  const ast = acornJsx.parse(code, {
    ecmaVersion: "latest",
    sourceType: "module",
  });

  // 2. Walk AST and find ALL JSXElement/JSXSelfClosingElement nodes
  // This includes JSX nested in expressions like map callbacks
  const replacements: Array<{
    start: number;
    end: number;
    replacement: string;
  }> = [];

  function walk(node: any) {
    if (node.type === "JSXElement") {
      // <Component prop={val}>children</Component>
      // → h(Component, { prop: val }, ...children)
      const componentName = node.openingElement.name.name;
      const props = transformProps(node.openingElement.attributes, code);
      const children = node.children
        .map((child) => transformChild(child, code, replacements))
        .filter(Boolean);

      const hCall = `h(${componentName}, ${props}${children.length > 0 ? ", " + children.join(", ") : ""})`;
      replacements.push({
        start: node.start,
        end: node.end,
        replacement: hCall,
      });
    }

    if (node.type === "JSXSelfClosingElement") {
      // <Component /> → h(Component, null)
      const componentName = node.name.name;
      const props = transformProps(node.attributes, code);

      const hCall = `h(${componentName}, ${props})`;
      replacements.push({
        start: node.start,
        end: node.end,
        replacement: hCall,
      });
    }

    // Recursively walk ALL properties to find nested JSX
    // This catches JSX inside expressions like: {data.map(d => <Component />)}
    for (const key in node) {
      if (node[key] && typeof node[key] === "object") {
        if (Array.isArray(node[key])) {
          node[key].forEach(walk);
        } else {
          walk(node[key]);
        }
      }
    }
  }

  walk(ast);

  // 3. Apply replacements carefully to handle nested JSX
  // Sort innermost-first (by range size), then right-to-left
  // This ensures nested JSX in expressions is replaced before containing expressions
  replacements.sort((a, b) => {
    const aSize = a.end - a.start;
    const bSize = b.end - b.start;
    // Smaller ranges (inner elements) first
    if (aSize !== bSize) return aSize - bSize;
    // For same size, rightmost first
    return b.start - a.start;
  });

  // Apply replacements and track position shifts
  let transformed = code;
  let offset = 0; // Track how positions have shifted
  const sortedByPosition = [...replacements].sort((a, b) => a.start - b.start);

  for (const { start, end, replacement } of sortedByPosition) {
    const adjustedStart = start + offset;
    const adjustedEnd = end + offset;
    transformed =
      transformed.slice(0, adjustedStart) +
      replacement +
      transformed.slice(adjustedEnd);
    offset += replacement.length - (end - start);
  }

  // 4. Append return Widget statement
  transformed += "\n\nreturn Widget;";

  return transformed;
}

function transformProps(attributes: any[], code: string): string {
  if (!attributes || attributes.length === 0) return "null";

  const props = attributes.map((attr) => {
    const name = attr.name.name;
    if (attr.value === null) {
      // Boolean prop: disabled → disabled: true
      return `${name}: true`;
    } else if (attr.value.type === "Literal") {
      // String literal: type="text" → type: "text"
      return `${name}: ${JSON.stringify(attr.value.value)}`;
    } else if (attr.value.type === "JSXExpressionContainer") {
      // Expression: value={state.x} → value: state.x
      // Leave expression as-is from original code
      const expression = code.slice(
        attr.value.expression.start,
        attr.value.expression.end
      );
      return `${name}: ${expression}`;
    }
  });

  return `{ ${props.join(", ")} }`;
}

function transformChild(child: any, code: string, replacements: any[]): string | null {
  if (child.type === "JSXText") {
    const trimmed = child.value.trim();
    return trimmed ? JSON.stringify(trimmed) : null;
  } else if (child.type === "JSXElement" || child.type === "JSXSelfClosingElement") {
    // This JSX child will be found by walk() and added to replacements
    // We extract it from the original code here, and it will be transformed
    // when we apply all replacements
    return code.slice(child.start, child.end);
  } else if (child.type === "JSXExpressionContainer") {
    // Expression container - extract the expression
    // Any JSX inside this expression will be found by walk() and transformed
    // For example: {data.map(d => <Container />)}
    // The <Container /> will be found and added to replacements
    return code.slice(child.expression.start, child.expression.end);
  }
  return null;
}
```

**Key transformations:**

- `<Component>` → `h(Component, null)`
- `<Component prop="value">` → `h(Component, { prop: "value" })`
- `<Component prop={expr}>` → `h(Component, { prop: expr })` - expressions left as-is
- `<Component>text</Component>` → `h(Component, null, "text")`
- `<Component>{expr}</Component>` → `h(Component, null, expr)` - expressions left as-is
- `<Container>{data.map(d => <Item />)}</Container>` → `h(Container, null, data.map(d => h(Item, null)))` - JSX inside expressions is also transformed

**Handling nested JSX in expressions:**

The transformation handles complex cases like JSX inside map/filter callbacks:

```javascript
// Input
<Container>
  {items.map(item => (
    <Item key={item.id}>
      <Text>{item.name}</Text>
    </Item>
  ))}
</Container>

// Output
h(Container, null, items.map(item => (
  h(Item, { key: item.id },
    h(Text, null, item.name)
  )
)))
```

**Implementation approach:**
1. Walk the entire AST tree recursively, finding ALL JSX elements (including those in arrow functions, callbacks, etc.)
2. Build h() calls for each JSX element using original source positions
3. Sort replacements by size (innermost first) to identify nested elements
4. Apply replacements left-to-right while tracking position offset changes
5. This ensures that JSX nested inside expressions is transformed correctly

### 2. Widget Validation (validate_widget.ts)

**Structure:**

```typescript
import { validateCode, ValidationResult } from "./validate_code";
import * as acorn from "acorn";

export function validateWidgetCode(code: string): ValidationResult {
  const errors: string[] = [];

  // 1. Run existing security validation
  const baseValidation = validateCode(code, [
    "state",
    "setState",
    "h",
    "codeTools",
  ]);
  if (!baseValidation.isValid) {
    return baseValidation;
  }

  // 2. Parse code to check structure
  let ast;
  try {
    ast = acorn.parse(code, {
      ecmaVersion: "latest",
      sourceType: "module",
    });
  } catch (err) {
    return {
      isValid: false,
      errors: [`Failed to parse code: ${err.message}`],
    };
  }

  // 3. Check for Widget function (no export required)
  let hasWidgetFunction = false;
  let hasCorrectSignature = false;

  function walk(node: any) {
    if (
      node.type === "FunctionDeclaration" &&
      node.id?.name === "Widget"
    ) {
      hasWidgetFunction = true;

      // Check signature: Widget({ state, setState })
      const params = node.params;
      if (params.length === 1 && params[0].type === "ObjectPattern") {
        const properties = params[0].properties;
        const hasState = properties.some((p) => p.key?.name === "state");
        const hasSetState = properties.some((p) => p.key?.name === "setState");
        if (hasState && hasSetState) {
          hasCorrectSignature = true;
        }
      }
    }

    for (const key in node) {
      if (node[key] && typeof node[key] === "object") {
        if (Array.isArray(node[key])) {
          node[key].forEach(walk);
        } else {
          walk(node[key]);
        }
      }
    }
  }

  walk(ast);

  if (!hasWidgetFunction) {
    errors.push('Code must define a function named "Widget"');
  }
  if (!hasCorrectSignature) {
    errors.push("Widget function must accept { state, setState } as parameter");
  }

  // 4. Check for Widget.initialState (basic check only)
  const hasInitialState = /Widget\.initialState\s*=/.test(code);
  if (!hasInitialState) {
    errors.push("Widget must define Widget.initialState");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
```

**Validation rules:**

1. Must define function named `Widget` (no export required)
2. Widget must accept `{ state, setState }` parameter
3. Must define `Widget.initialState` property
4. Must pass existing security checks (no eval, require, etc.)

### 3. build_widget Tool (build_widget.ts)

**Tool definition:**

```typescript
import { z } from "zod";
import { transformJSXToH } from "./transform_jsx";
import { validateWidgetCode } from "./validate_widget";
import type { AgentMessage } from "../types";

export function createBuildWidgetTool(
  sendMessage: (message: AgentMessage) => void
) {
  return {
    description: `Build an interactive UI widget with JSX syntax.

The widget can manage local state and call code tools for actions.

Example:
\`\`\`javascript
function Widget({ state, setState }) {
  return (
    <Container>
      <Input
        value={state.email}
        onChange={(val) => setState({ email: val })}
        placeholder="Enter email"
      />
      <Button onClick={() => codeTools.sendEmail(state.email)}>
        Send
      </Button>
    </Container>
  )
}

Widget.initialState = { email: '' }
\`\`\`

Available components:
- Container: Flex container with spacing
- Input: Text input with onChange
- Textarea: Multiline text input
- Button: Clickable button with onClick
- Text: Text display with variants (heading, subheading, body)
- Card: Elevated container with shadow

State management:
- Access current state via \`state\` prop
- Update state via \`setState({ key: value })\`
- State updates trigger re-render

Code tools access:
- Call any discovered code tool: \`codeTools.toolName(args)\`
- Tool calls are async, use await if needed
- Results can be stored in state
`,

    inputSchema: z.object({
      code: z.string().describe("Widget component code with JSX syntax"),
    }),

    execute: async ({ code }: { code: string }) => {
      try {
        // 1. Validate widget code
        const validation = validateWidgetCode(code);
        if (!validation.isValid) {
          return {
            success: false,
            error: `Widget validation failed:\n${validation.errors.join("\n")}`,
          };
        }

        // 2. Transform JSX to h() calls and append return statement
        let transformed: string;
        try {
          transformed = transformJSXToH(code);
        } catch (err) {
          return {
            success: false,
            error: `JSX transformation failed: ${err.message}`,
          };
        }

        // 3. Generate unique widget ID
        const widgetId = `widget-${Date.now()}-${Math.random()
          .toString(36)
          .substring(2, 9)}`;

        // 4. Send widget_created message to client
        // Client can access Widget.initialState from the code
        sendMessage({
          type: "widget_created",
          widgetId,
          code: transformed,
        });

        return {
          success: true,
          widgetId,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
        };
      }
    },
  };
}
```

### 4. /code-tool Endpoint (routes.ts)

**Add new endpoint:**

```typescript
// Add POST /code-tool endpoint for widget tool execution
router.post("/code-tool", async (req, res) => {
  const { toolName, args, secrets, approvalToken } = req.body;

  // Validate request
  if (!toolName || typeof toolName !== "string") {
    return res.status(400).json({
      success: false,
      error: "toolName is required and must be a string",
    });
  }

  try {
    // Load tools (reuse existing loadTools)
    const context: ToolExecutionContext = {
      secrets: secrets || {},
      requestApproval: async (prompt: string) => {
        // Send approval_required response instead of throwing
        // Client should prompt user and retry with approvalToken
        if (!approvalToken) {
          // Return special response indicating approval needed
          res.json({
            success: false,
            requiresApproval: true,
            approvalPrompt: prompt,
          });
          return false;
        }

        // If approvalToken provided, validate it
        // (Implementation depends on how approval tokens are managed)
        return true;
      },
      workspacePath,
    };

    const { codeTools } = await loadTools(context);

    // Find requested tool
    const tool = codeTools[toolName];
    if (!tool) {
      const available = Object.keys(codeTools);
      return res.status(404).json({
        success: false,
        error: `Tool '${toolName}' not found. Available tools: ${available.join(
          ", "
        )}`,
      });
    }

    // Execute tool
    console.log(`[/code-tool] Executing ${toolName} with args:`, args);
    const result = await tool.execute(args);

    res.json({
      success: true,
      result,
    });
  } catch (error: any) {
    console.error("[/code-tool] Execution error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Tool execution failed",
    });
  }
});
```

**Note:** This endpoint is called by the SDK from within the agent process. The client application's server would proxy requests to this endpoint, passing along secrets and handling the approval flow.

**Integrate build_widget in main route:**

```typescript
// In POST /api/agent handler, after loading tools:

// Create build_widget tool
const buildWidgetTool = createBuildWidgetTool(queueMessage);

// Add to native tools
const allNativeTools = {
  ...nativeTools,
  build_widget: buildWidgetTool,
};

// Wrap with message handlers
const wrappedNativeTools = wrapNativeToolsWithMessages(
  allNativeTools,
  sendMessage
);

// Convert to AI SDK format
const aiSDKNativeTools = convertNativeToolsToAISDK(wrappedNativeTools);

// Include in streamText call
const result = streamText({
  tools: {
    ...aiSDKNativeTools,
    ...aiSDKCodeTools,
  },
  // ... other options
});
```

## Client-Side Implementation (Reference Only - Out of Scope)

The client receives the `widget_created` message and is responsible for:

1. **Creating h() function:**

   ```javascript
   const h = (component, props, ...children) => {
     const Component = COMPONENTS[component] || component;
     return <Component {...props}>{children}</Component>;
   };
   ```

2. **Executing widget code:**

   ```javascript
   // Execute transformed code to get Widget function
   const widgetFunction = new Function(
     "state",
     "setState",
     "h",
     "codeTools",
     ...Object.keys(COMPONENTS),
     transformedCode // Already includes "return Widget;" at the end
   );

   // Get the Widget function
   const Widget = widgetFunction(
     null, // state not needed yet
     null, // setState not needed yet
     h,
     codeTools,
     ...Object.values(COMPONENTS)
   );

   // Get initial state from Widget.initialState
   const [state, setState] = useState(Widget.initialState);

   // Render the widget
   const element = Widget({ state, setState });
   ```

3. **Providing codeTools proxy:**

   ```javascript
   const codeTools = new Proxy(
     {},
     {
       get: (_, toolName) => {
         return async (...args) => {
           // Client's server proxies to SDK's /code-tool endpoint
           const response = await fetch("/api/widget-tool", {
             method: "POST",
             headers: { "Content-Type": "application/json" },
             body: JSON.stringify({
               toolName,
               args: args[0],
               secrets: getSecrets(), // Client provides secrets
             }),
           });
           const data = await response.json();

           // Handle approval flow if needed
           if (data.requiresApproval) {
             const approved = await promptUserForApproval(data.approvalPrompt);
             if (approved) {
               // Retry with approval token
               return callWithApproval(toolName, args[0]);
             }
             throw new Error("User denied approval");
           }

           if (!data.success) throw new Error(data.error);
           return data.result;
         };
       },
     }
   );
   ```

4. **Defining components:**
   ```javascript
   const COMPONENTS = {
     Container: ({ children }) => (
       <div className="flex flex-col gap-4">{children}</div>
     ),
     Input: ({ value, onChange, placeholder }) => (
       <input
         value={value}
         onChange={(e) => onChange(e.target.value)}
         placeholder={placeholder}
       />
     ),
     Button: ({ children, onClick }) => (
       <button onClick={onClick}>{children}</button>
     ),
     // ... etc
   };
   ```

## Security

### Server-Side Validation

**Code structure:**

- Must define Widget function (no export required)
- Must accept { state, setState }
- Must define Widget.initialState property

**AST-based security (reuse validate_code.ts):**

- Block: eval, require, import, Function, process, global, globalThis
- Block: setTimeout, setInterval, setImmediate
- Block: nested constructor access
- Block: while/do-while loops
- Allow only: standard JS globals + state, setState, h, codeTools, component names

**JSX transformation:**

- Only allow known component names (Container, Input, Button, etc.)
- Validate props don't inject dangerous code
- Sanitize string literals

### Client-Side Security (Client Responsibility)

- Execute in `new Function()` with controlled scope
- No access to window, document, or browser globals
- Only injected parameters available
- Rate limit /code-tool requests

### Limits

- Widget code size: 10KB max
- Tool call timeout: 30 seconds
- /code-tool rate limit: 100 req/min per client

## Testing

### Overview

We use **Vitest** as the test runner for all acorn-based JSX transformation and widget validation logic. This provides:

- Fast test execution with ESM support
- TypeScript support out of the box
- Code coverage reporting
- Watch mode for TDD workflow

**Test files:**
- `src/agent/tools/__tests__/transform_jsx.test.ts` - 50+ tests for JSX transformation
- `src/agent/tools/__tests__/validate_widget.test.ts` - 30+ tests for widget validation

**Run tests:**
```bash
cd packages/together-agent
npm test                   # Run all tests
npm test -- --coverage     # Generate coverage report
npm test -- --watch        # Run in watch mode
```

### Vitest Configuration

Create `packages/together-agent/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/agent/tools/transform_jsx.ts", "src/agent/tools/validate_widget.ts"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

### Unit Tests

**1. JSX Transformation (`src/agent/tools/__tests__/transform_jsx.test.ts`):**

```typescript
import { describe, test, expect } from "vitest";
import { transformJSXToH } from "../transform_jsx";

describe("transformJSXToH - Basic Elements", () => {
  test("self-closing element", () => {
    const input = "<Container />";
    const output = transformJSXToH(input);
    expect(output).toContain("h(Container, null)");
    expect(output).toContain("return Widget;");
  });

  test("element with opening and closing tags", () => {
    const input = "<Container></Container>";
    const output = transformJSXToH(input);
    expect(output).toContain("h(Container, null)");
  });

  test("element with text children", () => {
    const input = "<Button>Click me</Button>";
    const output = transformJSXToH(input);
    expect(output).toContain('h(Button, null, "Click me")');
  });

  test("element with whitespace-only children", () => {
    const input = "<Button>   </Button>";
    const output = transformJSXToH(input);
    expect(output).toContain("h(Button, null)");
  });
});

describe("transformJSXToH - Props", () => {
  test("string literal prop", () => {
    const input = '<Input type="text" />';
    const output = transformJSXToH(input);
    expect(output).toContain('h(Input, { type: "text" })');
  });

  test("expression prop", () => {
    const input = "<Input value={state.name} />";
    const output = transformJSXToH(input);
    expect(output).toContain("h(Input, { value: state.name })");
  });

  test("multiple props", () => {
    const input = '<Input type="text" value={state.name} placeholder="Enter name" />';
    const output = transformJSXToH(input);
    expect(output).toContain('type: "text"');
    expect(output).toContain("value: state.name");
    expect(output).toContain('placeholder: "Enter name"');
  });

  test("boolean prop", () => {
    const input = "<Input disabled />";
    const output = transformJSXToH(input);
    expect(output).toContain("h(Input, { disabled: true })");
  });

  test("arrow function prop", () => {
    const input = "<Button onClick={() => console.log('clicked')} />";
    const output = transformJSXToH(input);
    expect(output).toContain("onClick: () => console.log('clicked')");
  });

  test("arrow function with setState", () => {
    const input = "<Input onChange={(val) => setState({ name: val })} />";
    const output = transformJSXToH(input);
    expect(output).toContain("onChange: (val) => setState({ name: val })");
  });
});

describe("transformJSXToH - Nested Elements", () => {
  test("simple nesting", () => {
    const input = "<Container><Input /></Container>";
    const output = transformJSXToH(input);
    expect(output).toContain("h(Input, null)");
    expect(output).toContain("h(Container,");
  });

  test("multiple children", () => {
    const input = "<Container><Input /><Button /></Container>";
    const output = transformJSXToH(input);
    expect(output).toContain("h(Input, null)");
    expect(output).toContain("h(Button, null)");
    expect(output).toContain("h(Container,");
  });

  test("deeply nested", () => {
    const input = `
      <Container>
        <Card>
          <Text>Hello</Text>
        </Card>
      </Container>
    `;
    const output = transformJSXToH(input);
    expect(output).toContain("h(Container,");
    expect(output).toContain("h(Card,");
    expect(output).toContain('h(Text, null, "Hello")');
    expect(output).not.toContain("<");
  });
});

describe("transformJSXToH - Expression Children", () => {
  test("expression with variable", () => {
    const input = "<Text>{state.name}</Text>";
    const output = transformJSXToH(input);
    expect(output).toContain("h(Text, null, state.name)");
  });

  test("expression with function call", () => {
    const input = "<Text>{formatDate(state.date)}</Text>";
    const output = transformJSXToH(input);
    expect(output).toContain("h(Text, null, formatDate(state.date))");
  });
});

describe("transformJSXToH - JSX in Expressions", () => {
  test("map with simple JSX", () => {
    const input = "<Container>{items.map(item => <Item key={item.id} />)}</Container>";
    const output = transformJSXToH(input);
    expect(output).toContain("items.map(item => h(Item, { key: item.id }))");
    expect(output).not.toContain("<Item");
  });

  test("map with nested JSX", () => {
    const input = `
      <Container>
        {data.map(d => (
          <Card>
            <Text>{d.name}</Text>
          </Card>
        ))}
      </Container>
    `;
    const output = transformJSXToH(input);
    expect(output).toContain("h(Container,");
    expect(output).toContain("h(Card,");
    expect(output).toContain("h(Text,");
    expect(output).not.toContain("<");
  });

  test("filter and map chain", () => {
    const input = "<Container>{items.filter(i => i.active).map(i => <Item key={i.id} />)}</Container>";
    const output = transformJSXToH(input);
    expect(output).toContain("items.filter(i => i.active).map(i => h(Item, { key: i.id }))");
  });

  test("conditional JSX with ternary", () => {
    const input = "<Container>{state.loading ? <Spinner /> : <Content />}</Container>";
    const output = transformJSXToH(input);
    expect(output).toContain("state.loading ? h(Spinner, null) : h(Content, null)");
  });

  test("logical AND with JSX", () => {
    const input = "<Container>{state.show && <Alert />}</Container>";
    const output = transformJSXToH(input);
    expect(output).toContain("state.show && h(Alert, null)");
  });

  test("nested map in map", () => {
    const input = `
      <Container>
        {groups.map(group => (
          <Section key={group.id}>
            {group.items.map(item => <Item key={item.id} />)}
          </Section>
        ))}
      </Container>
    `;
    const output = transformJSXToH(input);
    expect(output).not.toContain("<");
    expect(output).toContain("h(Container,");
    expect(output).toContain("h(Section,");
    expect(output).toContain("h(Item,");
  });
});

describe("transformJSXToH - Complete Widget Examples", () => {
  test("widget with state and handlers", () => {
    const input = `
      function Widget({ state, setState }) {
        return (
          <Container>
            <Input
              value={state.email}
              onChange={(val) => setState({ email: val })}
            />
            <Button onClick={() => codeTools.send(state.email)}>
              Send
            </Button>
          </Container>
        );
      }
      Widget.initialState = { email: '' };
    `;
    const output = transformJSXToH(input);
    expect(output).toContain("h(Container,");
    expect(output).toContain("h(Input,");
    expect(output).toContain("h(Button,");
    expect(output).toContain("onChange: (val) => setState({ email: val })");
    expect(output).toContain("return Widget;");
    expect(output).not.toContain("<");
  });
});
```

**2. Widget Validation (`src/agent/tools/__tests__/validate_widget.test.ts`):**

```typescript
import { describe, test, expect } from "vitest";
import { validateWidgetCode } from "../validate_widget";

describe("validateWidgetCode - Valid Widgets", () => {
  test("valid widget with all requirements", () => {
    const code = `
      function Widget({ state, setState }) {
        return <Container />;
      }
      Widget.initialState = { count: 0 };
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("valid widget with complex JSX", () => {
    const code = `
      function Widget({ state, setState }) {
        return (
          <Container>
            <Input value={state.name} onChange={(v) => setState({ name: v })} />
            <Button onClick={() => codeTools.save(state)}>Save</Button>
          </Container>
        );
      }
      Widget.initialState = { name: '' };
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(true);
  });

  test("valid widget with map expression", () => {
    const code = `
      function Widget({ state, setState }) {
        return (
          <Container>
            {state.items.map(item => <Item key={item.id} />)}
          </Container>
        );
      }
      Widget.initialState = { items: [] };
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(true);
  });
});

describe("validateWidgetCode - Missing Structure", () => {
  test("missing Widget function", () => {
    const code = `
      function Foo({ state, setState }) {
        return <Container />;
      }
      Foo.initialState = {};
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Code must define a function named "Widget"');
  });

  test("missing function signature", () => {
    const code = `
      function Widget() {
        return <Container />;
      }
      Widget.initialState = {};
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("Widget function must accept { state, setState } as parameter");
  });

  test("incorrect parameter destructuring", () => {
    const code = `
      function Widget({ state }) {
        return <Container />;
      }
      Widget.initialState = {};
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("Widget function must accept { state, setState } as parameter");
  });

  test("missing initialState", () => {
    const code = `
      function Widget({ state, setState }) {
        return <Container />;
      }
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("Widget must define Widget.initialState");
  });
});

describe("validateWidgetCode - Security Checks", () => {
  test("blocks eval", () => {
    const code = `
      function Widget({ state, setState }) {
        eval('console.log("bad")');
        return <Container />;
      }
      Widget.initialState = {};
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes("eval"))).toBe(true);
  });

  test("blocks require", () => {
    const code = `
      function Widget({ state, setState }) {
        const fs = require('fs');
        return <Container />;
      }
      Widget.initialState = {};
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(false);
  });

  test("blocks import", () => {
    const code = `
      import fs from 'fs';
      function Widget({ state, setState }) {
        return <Container />;
      }
      Widget.initialState = {};
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(false);
  });

  test("blocks Function constructor", () => {
    const code = `
      function Widget({ state, setState }) {
        const fn = new Function('return 1');
        return <Container />;
      }
      Widget.initialState = {};
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(false);
  });

  test("blocks process access", () => {
    const code = `
      function Widget({ state, setState }) {
        console.log(process.env);
        return <Container />;
      }
      Widget.initialState = {};
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(false);
  });

  test("blocks setTimeout", () => {
    const code = `
      function Widget({ state, setState }) {
        setTimeout(() => {}, 1000);
        return <Container />;
      }
      Widget.initialState = {};
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(false);
  });

  test("blocks while loops", () => {
    const code = `
      function Widget({ state, setState }) {
        while (true) {}
        return <Container />;
      }
      Widget.initialState = {};
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(false);
  });
});

describe("validateWidgetCode - Allowed Code", () => {
  test("allows standard JavaScript", () => {
    const code = `
      function Widget({ state, setState }) {
        const name = state.name.toUpperCase();
        const count = state.count + 1;
        return <Text>{name}: {count}</Text>;
      }
      Widget.initialState = { name: 'test', count: 0 };
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(true);
  });

  test("allows for loops", () => {
    const code = `
      function Widget({ state, setState }) {
        const items = [];
        for (let i = 0; i < 5; i++) {
          items.push(i);
        }
        return <Container />;
      }
      Widget.initialState = {};
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(true);
  });

  test("allows array methods", () => {
    const code = `
      function Widget({ state, setState }) {
        const filtered = state.items.filter(i => i.active);
        const mapped = filtered.map(i => i.name);
        return <Container>{mapped.join(', ')}</Container>;
      }
      Widget.initialState = { items: [] };
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(true);
  });

  test("allows codeTools access", () => {
    const code = `
      function Widget({ state, setState }) {
        return (
          <Button onClick={() => codeTools.sendEmail(state.email)}>
            Send
          </Button>
        );
      }
      Widget.initialState = { email: '' };
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(true);
  });

  test("allows conditional rendering", () => {
    const code = `
      function Widget({ state, setState }) {
        return (
          <Container>
            {state.loading && <Spinner />}
            {state.error ? <Alert>{state.error}</Alert> : <Content />}
          </Container>
        );
      }
      Widget.initialState = { loading: false, error: null };
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(true);
  });
});

describe("validateWidgetCode - Edge Cases", () => {
  test("handles empty Widget body", () => {
    const code = `
      function Widget({ state, setState }) {
        return <Container />;
      }
      Widget.initialState = {};
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(true);
  });

  test("handles complex initialState", () => {
    const code = `
      function Widget({ state, setState }) {
        return <Container />;
      }
      Widget.initialState = {
        name: '',
        items: [],
        config: { theme: 'dark', size: 'large' },
        count: 0
      };
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(true);
  });
});
```

### Integration Tests

**3. /code-tool Endpoint:**

```bash
# Test successful tool call
curl -X POST http://localhost:3000/code-tool \
  -H "Content-Type: application/json" \
  -d '{"toolName": "getWeather", "args": {"location": "SF"}, "secrets": {"WEATHER_API_KEY": "..."}}'

# Expected response:
# {"success": true, "result": { ... weather data ... }}

# Test tool requiring approval
curl -X POST http://localhost:3000/code-tool \
  -H "Content-Type: application/json" \
  -d '{"toolName": "sendEmail", "args": {"to": "user@example.com"}}'

# Expected response (no approval token):
# {"success": false, "requiresApproval": true, "approvalPrompt": "Send email to user@example.com?"}

# Test tool not found
curl -X POST http://localhost:3000/code-tool \
  -H "Content-Type: application/json" \
  -d '{"toolName": "nonExistent", "args": {}}'

# Expected response:
# {"success": false, "error": "Tool 'nonExistent' not found. Available tools: ..."}
```

**4. End-to-End Flow:**

1. LLM calls build_widget with JSX code
2. Server validates and transforms code (appends `return Widget;`)
3. Server sends widget_created message
4. Verify message has correct structure:
   - widgetId is unique string
   - code is transformed (has h() calls and `return Widget;` at end)
   - Widget.initialState is accessible in the code

## Implementation Phases

### Phase 0: Setup Testing Infrastructure (Day 1)

1. Add `vitest` as dev dependency
2. Create `vitest.config.ts` with configuration
3. Add test script to `package.json`
4. Verify test runner works with a basic test

### Phase 1: Core Transformation (Days 1-2)

1. Add `acorn-jsx` dependency
2. Implement `transform_jsx.ts` with basic functionality
3. Write unit tests in `__tests__/transform_jsx.test.ts`:
   - Basic elements
   - Props (string, expression, boolean, functions)
   - Nested elements
   - Expression children
   - JSX in expressions (map, filter, conditionals)
4. Run tests: `npm test` and fix issues iteratively
5. Verify all transformation tests pass

### Phase 2: Validation (Day 3)

6. Implement `validate_widget.ts`
7. Write unit tests in `__tests__/validate_widget.test.ts`:
   - Valid widgets
   - Missing structure
   - Security checks (eval, require, import, etc.)
   - Allowed code patterns
   - Edge cases
8. Run tests: `npm test` and fix issues
9. Verify all validation tests pass

### Phase 3: Tool & Endpoint (Days 4-5)

10. Add `WidgetCreatedMessage` to types
11. Implement `build_widget.ts` tool (with validation + transformation)
12. Add `/code-tool` endpoint to routes.ts with approval support
13. Integrate build_widget into main route
14. Manual testing with curl requests

### Phase 4: Integration Testing (Day 6)

15. Test complete flow: LLM → build_widget → transformation → message
16. Test /code-tool with various code tools
17. Test approval flow in /code-tool
18. Test error handling at all layers
19. Test with real widget examples
20. Run `npm test` for full test suite coverage

## Success Criteria

✅ **Test infrastructure:** Vitest configured and running with `npm test`
✅ **Transformation works:** JSX → h() calls correctly for all test cases, including nested JSX in expressions
✅ **Nested JSX handling:** JSX inside map/filter callbacks and arrow functions is transformed correctly
✅ **Test coverage:** All transform_jsx.ts tests passing (50+ test cases)
✅ **Validation works:** Catches missing structure, dangerous code
✅ **Validation tests:** All validate_widget.ts tests passing (30+ test cases)
✅ **Tool integration:** build_widget appears in tool list and is callable
✅ **Message format:** widget_created has correct structure
✅ **Tool execution:** /code-tool endpoint executes tools and returns results
✅ **Approval flow:** /code-tool properly handles tools requiring approval
✅ **Error handling:** Clear error messages for all failure modes
✅ **Security:** Dangerous code is blocked by validation
✅ **CI/CD ready:** All tests can run in automated pipeline

## Potential Issues & Mitigations

### Issue: Complex JSX Patterns

**Problem:** Fragments, spread props, conditional rendering
**Mitigation:** Start with subset of JSX. Document limitations. Add support incrementally.

### Issue: JSX Transformation Bugs

**Problem:** Edge cases in transformation logic, especially nested elements
**Mitigation:** Comprehensive unit tests. Test against real-world patterns. Use placeholder/marker system or recursive transformation for nested elements.

### Issue: Tool Discovery

**Problem:** Widget doesn't know which tools exist
**Mitigation:** /code-tool returns 404 with available tools list

### Issue: Security Bypass

**Problem:** Malicious code tries to escape sandbox
**Mitigation:** Multi-layer validation. AST checks + runtime sandbox (client-side).

### Issue: Performance

**Problem:** Transformation might be slow for large widgets
**Mitigation:** Add code size limit (10KB). Transformation should be < 100ms.

## Future Enhancements (Out of Scope for V1)

- JSX fragments: `<>...</>`
- Spread props: `<Component {...props} />`
- Conditional rendering: `{condition && <Component />}`
- Map/iteration: `{items.map(item => <Item key={item.id} />)}`
- Custom components: Allow defining nested components
- Widget-to-widget communication
- Persistent widget state (localStorage)
- More component primitives (Table, List, Modal, etc.)
- Approval flow in widgets
- Real-time updates (WebSocket connection)
