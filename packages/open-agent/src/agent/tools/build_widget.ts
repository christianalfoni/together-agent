import { z } from "zod";
import { transformJSXToH } from "./transform_jsx";
import { validateWidgetCode } from "./validate_widget";
import type { AgentMessage } from "../types";

/**
 * Creates the build_widget tool for constructing interactive UI widgets.
 * Widgets use JSX syntax and are transformed to h() function calls for client-side rendering.
 */
export function createBuildWidgetTool(
  sendMessage: (message: AgentMessage) => void
) {
  return {
    description: `Build an interactive UI widget with JSX syntax.

Widgets can manage local state and call code tools for actions.
The function can be named anything descriptive (e.g., EmailViewer, Dashboard, etc.).

Example:
\`\`\`javascript
function EmailForm({ state, setState }) {
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

EmailForm.initialState = { email: '' }
\`\`\`

Available components (ONLY these are allowed - NO HTML elements like div, span, etc.):
- Container: Flex container with spacing (use instead of div)
- Input: Text input with onChange handler
- Textarea: Multiline text input
- Button: Clickable button with onClick handler
- Text: Text display with variants (heading, subheading, body) (use instead of span, p, h1, etc.)
- Card: Elevated container with shadow
- Spinner: Loading spinner indicator
- Alert: Alert box with variants (info, success, warning, error)

IMPORTANT: Do NOT use HTML elements (div, span, p, h1, img, etc.). Only use the components listed above.

State management:
IMPORTANT: Only use the state and setState props for state management. No other state management libraries or patterns are allowed.
- Access current state via the state prop passed to Widget function
- Update state via the setState prop: setState({ key: value })
- setState merges updates into existing state
- State updates trigger re-render
- Define initial state with Widget.initialState

Code tools access:
- Call any discovered code tool: codeTools.toolName(args)
- Tool calls are async, use await if needed
- Results can be stored in state
`,

    inputSchema: z.object({
      code: z.string().describe("Widget component code with JSX syntax"),
    }),

    outputSchema: z.object({
      success: z.boolean(),
      widgetId: z.string().optional(),
      error: z.string().optional(),
    }),

    execute: async ({ code }: { code: string }) => {
      try {
        // 1. Transform JSX to h() calls
        let transformed: string;
        try {
          transformed = transformJSXToH(code);
        } catch (err: any) {
          console.error('JSX Transformation Failed:');
          console.error('Original code:', code);
          console.error('Error:', err.message);
          return {
            success: false,
            error: `JSX transformation failed: ${err.message}`,
          };
        }

        // 2. Validate transformed code (what actually executes)
        const validation = validateWidgetCode(transformed);
        if (!validation.isValid) {
          console.error('Widget Validation Failed:');
          console.error('Original JSX code:', code);
          console.error('Transformed code:', transformed);
          console.error('Validation errors:', validation.errors);
          return {
            success: false,
            error: `Widget validation failed:\n${validation.errors.join("\n")}`,
          };
        }

        // 3. Add return statement for client-side Function() execution
        // Use the detected function name from validation
        const functionName = validation.functionName || 'Widget';
        const executableCode = transformed + `\n\nreturn ${functionName};`;

        // 4. Generate unique widget ID
        const widgetId = `widget-${Date.now()}-${Math.random()
          .toString(36)
          .substring(2, 9)}`;

        // 5. Send widget_created message to client
        sendMessage({
          type: "widget_created",
          widgetId,
          code: executableCode,
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

    native: true, // Register as native Claude tool
  };
}
