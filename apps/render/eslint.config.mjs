import base from "@vidyam/config/eslint/base";
import cleanArchitecture from "@vidyam/config/eslint/clean-architecture";
import noLlmSdks from "@vidyam/config/eslint/no-llm-sdks";
import { defineConfig } from "eslint/config";

export default defineConfig([{ ignores: ["dist/**"] }, ...base, ...cleanArchitecture, ...noLlmSdks]);
