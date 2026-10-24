import base from "@vidyam/config/eslint/base";
import cleanArchitecture from "@vidyam/config/eslint/clean-architecture";
import noLlmSdks from "@vidyam/config/eslint/no-llm-sdks";
import { defineConfig } from "eslint/config";

export default defineConfig([
  { ignores: ["dist/**"] },
  ...base,
  ...cleanArchitecture,
  ...noLlmSdks,
  {
    // Nest resolves constructor dependencies from decorator metadata, so classes used only as constructor
    // parameter types are runtime imports. Telling the parser keeps consistent-type-imports from breaking DI.
    languageOptions: { parserOptions: { emitDecoratorMetadata: true, experimentalDecorators: true } },
  },
]);
