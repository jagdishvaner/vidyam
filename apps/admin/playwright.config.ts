import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the running local stack (`pnpm infra:up` + `pnpm dev`), through the same origin a
 * center admin uses: Caddy on :38001 (admin.<domain> in production).
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: process.env.VIDYAM_ADMIN_URL ?? "http://localhost:38001",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/admin.json" },
      dependencies: ["setup"],
    },
  ],
});
