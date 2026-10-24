import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Rules every TypeScript package starts from. Apps add framework presets on top. */
export default defineConfig([
  { ignores: ["**/dist/**", "**/.next/**", "**/coverage/**", "**/generated/**", "**/node_modules/**"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      eqeqeq: ["error", "smart"],
    },
  },
  {
    // Needs the TypeScript parser; frameworks (e.g. Next.js) may parse plain JS files with their own.
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    rules: { "@typescript-eslint/consistent-type-imports": "error" },
  },
]);
