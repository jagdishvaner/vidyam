import path from "node:path";

import { defineConfig } from "vitest/config";

try {
  process.loadEnvFile(path.resolve(import.meta.dirname, "../../.env"));
} catch {
  // CI provides the environment directly.
}

export default defineConfig({
  test: { include: ["test/**/*.integration.test.ts"], fileParallelism: false },
});
