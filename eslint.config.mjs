import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored minified opus-recorder encoder worker (served statically).
    "public/opus/**",
    // Isolated worktrees (each is a full separate checkout with its own
    // node_modules/lint state) -- linting them from the main checkout
    // double-counts every finding and can pick up in-progress work that
    // hasn't landed on this branch yet.
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
