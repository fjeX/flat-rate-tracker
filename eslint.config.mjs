import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Playwright specs and fixtures are not React. The fixture API hands each
    // fixture a callback named `use` as its second argument
    // (`async ({ browser }, use) => { ... await use(thing) }`), which
    // react-hooks reads as React 19's `use` hook being called outside a
    // component — a guaranteed false positive on every fixture file.
    files: ["tests/**"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
