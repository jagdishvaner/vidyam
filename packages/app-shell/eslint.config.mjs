import base from "@vidyam/config/eslint/base";
import noLlmSdks from "@vidyam/config/eslint/no-llm-sdks";
import nextVitals from "eslint-config-next/core-web-vitals";
import { defineConfig } from "eslint/config";

export default defineConfig([...nextVitals, ...base, ...noLlmSdks]);
