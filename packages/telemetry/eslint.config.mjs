import base from "@vidyam/config/eslint/base";
import { defineConfig } from "eslint/config";

export default defineConfig([{ ignores: ["dist/**"] }, ...base]);
