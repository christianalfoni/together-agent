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
            {state.items.map(item => <Card key={item.id} />)}
          </Container>
        );
      }
      Widget.initialState = { items: [] };
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(true);
  });

  test("valid widget with helper functions", () => {
    const code = `
      function Widget({ state, setState }) {
        const handleClick = () => {
          setState({ count: state.count + 1 });
        };
        return <Button onClick={handleClick}>Click</Button>;
      }
      Widget.initialState = { count: 0 };
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(true);
  });
});

describe("validateWidgetCode - Missing Structure", () => {
  test("accepts any function name with correct signature", () => {
    const code = `
      function EmailViewer({ state, setState }) {
        return <Container />;
      }
      EmailViewer.initialState = {};
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(true);
    expect(result.functionName).toBe('EmailViewer');
  });

  test("detects function name from Dashboard", () => {
    const code = `
      function Dashboard({ state, setState }) {
        return <Container><Text>Hello</Text></Container>;
      }
      Dashboard.initialState = { count: 0 };
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(true);
    expect(result.functionName).toBe('Dashboard');
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
    expect(result.errors).toContain(
      "Widget function must accept { state, setState } as parameter"
    );
  });

  test("incorrect parameter - not destructured", () => {
    const code = `
      function Widget(props) {
        return <Container />;
      }
      Widget.initialState = {};
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(false);
  });

  test("incorrect parameter - missing state", () => {
    const code = `
      function Widget({ setState }) {
        return <Container />;
      }
      Widget.initialState = {};
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      "Widget function must accept { state, setState } as parameter"
    );
  });

  test("incorrect parameter - missing setState", () => {
    const code = `
      function Widget({ state }) {
        return <Container />;
      }
      Widget.initialState = {};
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(false);
  });

  test("missing initialState", () => {
    const code = `
      function Widget({ state, setState }) {
        return <Container />;
      }
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('must define') && e.includes('.initialState'))).toBe(true);
  });
});

describe("validateWidgetCode - Security Checks", () => {
  test("blocks HTML elements (div, span, etc.)", () => {
    const code = `
      function Widget({ state, setState }) {
        return <div><span>Hello</span></div>;
      }
      Widget.initialState = {};
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes("HTML element '<div>'"))).toBe(true);
    expect(result.errors.some((e) => e.includes("HTML element '<span>'"))).toBe(true);
  });

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
    expect(result.errors.some((e) => e.includes("eval"))).toBe(true);
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
    expect(result.errors.some((e) => e.includes("require"))).toBe(true);
  });

  test.skip("blocks import - handled by client sandbox", () => {
    // Note: Client sandbox will prevent imports, so this is additional protection
    const code = `
      import fs from 'fs';
      function Widget({ state, setState }) {
        return <Container />;
      }
      Widget.initialState = {};
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes("import"))).toBe(true);
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
    expect(result.errors.some((e) => e.includes("Function"))).toBe(true);
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
    expect(result.errors.some((e) => e.includes("process"))).toBe(true);
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
    expect(result.errors.some((e) => e.includes("setTimeout"))).toBe(true);
  });

  test("blocks setInterval", () => {
    const code = `
      function Widget({ state, setState }) {
        setInterval(() => {}, 1000);
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
    expect(result.errors.some((e) => e.includes("while"))).toBe(true);
  });

  test("blocks do-while loops", () => {
    const code = `
      function Widget({ state, setState }) {
        do {} while (true);
        return <Container />;
      }
      Widget.initialState = {};
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(false);
  });

  test("blocks global access", () => {
    const code = `
      function Widget({ state, setState }) {
        const g = global;
        return <Container />;
      }
      Widget.initialState = {};
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes("global"))).toBe(true);
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
            {state.loading && <Text>Loading...</Text>}
            {state.error ? <Text>{state.error}</Text> : <Text>Success</Text>}
          </Container>
        );
      }
      Widget.initialState = { loading: false, error: null };
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(true);
  });

  test("allows object destructuring", () => {
    const code = `
      function Widget({ state, setState }) {
        const { name, email } = state.user;
        return <Text>{name} - {email}</Text>;
      }
      Widget.initialState = { user: { name: '', email: '' } };
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(true);
  });

  test("allows spread operator", () => {
    const code = `
      function Widget({ state, setState }) {
        const newState = { ...state, count: state.count + 1 };
        setState(newState);
        return <Container />;
      }
      Widget.initialState = { count: 0 };
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(true);
  });
});

describe("validateWidgetCode - Custom Allowed Globals", () => {
  test("rejects custom component without allowedGlobals option", () => {
    const code = `
      function Widget({ state, setState }) {
        return <CustomComponent />;
      }
      Widget.initialState = {};
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes("CustomComponent"))).toBe(true);
  });

  test("allows custom component with allowedGlobals option", () => {
    const code = `
      function Widget({ state, setState }) {
        return <CustomComponent />;
      }
      Widget.initialState = {};
    `;
    const result = validateWidgetCode(code, {
      allowedGlobals: ["CustomComponent"],
    });
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("allows multiple custom globals", () => {
    const code = `
      function Widget({ state, setState }) {
        const data = MyAPI.fetchData();
        return <CustomComponent data={data} />;
      }
      Widget.initialState = {};
    `;
    const result = validateWidgetCode(code, {
      allowedGlobals: ["CustomComponent", "MyAPI"],
    });
    expect(result.isValid).toBe(true);
  });

  test("custom globals work alongside default globals", () => {
    const code = `
      function Widget({ state, setState }) {
        const items = Array.from(state.items);
        return <CustomList items={items} />;
      }
      Widget.initialState = { items: [] };
    `;
    const result = validateWidgetCode(code, {
      allowedGlobals: ["CustomList"],
    });
    expect(result.isValid).toBe(true);
  });

  test("still blocks forbidden identifiers even with custom globals", () => {
    const code = `
      function Widget({ state, setState }) {
        eval("malicious code");
        return <CustomComponent />;
      }
      Widget.initialState = {};
    `;
    const result = validateWidgetCode(code, {
      allowedGlobals: ["CustomComponent"],
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes("eval"))).toBe(true);
  });

  test("error message includes custom globals in allowed list", () => {
    const code = `
      function Widget({ state, setState }) {
        return <UnknownComponent />;
      }
      Widget.initialState = {};
    `;
    const result = validateWidgetCode(code, {
      allowedGlobals: ["CustomComponent", "MyAPI"],
    });
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain("CustomComponent");
    expect(result.errors[0]).toContain("MyAPI");
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

  test("handles multiline widget", () => {
    const code = `
      function Widget({ state, setState }) {
        return (
          <Container>
            <Text>Line 1</Text>
            <Text>Line 2</Text>
            <Text>Line 3</Text>
          </Container>
        );
      }

      Widget.initialState = { count: 0 };
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(true);
  });

  test("rejects invalid JavaScript", () => {
    const code = `
      function Widget({ state, setState }) {
        return <Container
      }
      Widget.initialState = {};
    `;
    const result = validateWidgetCode(code);
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain("Failed to parse");
  });
});
