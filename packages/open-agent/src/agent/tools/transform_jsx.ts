import { transformSync } from "@babel/core";
// @ts-ignore - No types available but the package exists
import jsxPlugin from "@babel/plugin-transform-react-jsx";

/**
 * Transforms JSX code to h() function calls using Babel.
 * This is much more robust than a custom implementation and handles all edge cases.
 * Does NOT append "return Widget;" - that's added after validation in build_widget.ts
 */
export function transformJSXToH(code: string): string {
  try {
    const result = transformSync(code, {
      plugins: [
        [
          jsxPlugin,
          {
            pragma: "h", // Use h() instead of React.createElement()
            pragmaFrag: "Fragment", // Fragment support (though not used in widgets)
            throwIfNamespace: false, // Don't error on namespaced elements
          },
        ],
      ],
      configFile: false, // Don't look for babel.config.js
      babelrc: false, // Don't look for .babelrc
      sourceType: "module", // Support ESM syntax
      compact: true, // Minimize whitespace and line breaks
      retainLines: false, // Don't preserve original line numbers
    });

    if (!result || !result.code) {
      throw new Error("Babel transformation returned no code");
    }

    return result.code;
  } catch (error: any) {
    throw new Error(`JSX transformation failed: ${error.message}`);
  }
}
