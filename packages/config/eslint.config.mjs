import { defineConfig } from "eslint/config";

import base from "./eslint/base.mjs";

// test/fixtures deliberately break the rules; the preset test lints them through the ESLint API instead.
export default defineConfig([{ ignores: ["test/fixtures/**"] }, ...base]);
