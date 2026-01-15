import * as acorn from "acorn";
import * as acornJsx from "acorn-jsx";

const code = `
  function Widget({ state, setState }) {
    return <Container />;
  }
  Widget.initialState = { count: 0 };
`;

const WIDGET_ALLOWED_GLOBALS = new Set([
  "Array", "Boolean", "Date", "Error", "JSON", "Math", "Number", "Object",
  "String", "RegExp", "Map", "Set", "Promise", "parseInt", "parseFloat",
  "isNaN", "isFinite", "undefined", "NaN", "Infinity",
  "h", "codeTools", "Container", "Input", "Textarea", "Button", "Text",
  "Card", "Spinner", "Alert",
]);

try {
  const jsx = acornJsx.default || acornJsx;
  const acornWithJsx = acorn.Parser.extend(jsx());
  const ast = acornWithJsx.parse(code, {
    ecmaVersion: "latest",
    sourceType: "module",
  });
  
  console.log("Parsed successfully");
  console.log("AST type:", ast.type);
  console.log("Body:", ast.body.map(n => ({ type: n.type, id: n.id?.name })));
  
  // Check identifiers
  function findIdentifiers(node, parent = null, depth = 0) {
    if (!node || typeof node !== "object") return;
    
    if (node.type === "Identifier") {
      const indent = "  ".repeat(depth);
      console.log(`${indent}Identifier: ${node.name}, parent: ${parent?.type}`);
    }
    
    if (node.type === "JSXIdentifier") {
      const indent = "  ".repeat(depth);
      console.log(`${indent}JSXIdentifier: ${node.name}, parent: ${parent?.type}`);
    }
    
    for (const key in node) {
      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach((c) => findIdentifiers(c, node, depth + 1));
      } else if (child && typeof child === "object" && key !== "parent") {
        findIdentifiers(child, node, depth + 1);
      }
    }
  }
  
  findIdentifiers(ast);
  
} catch (err) {
  console.error("Error:", err.message);
}
