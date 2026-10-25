import { expect, test as setup } from "@playwright/test";

export const ADMIN_STATE = "e2e/.auth/admin.json";

/** Sign in once and reuse the session in every test (rate limits apply locally too, as in production). */
setup("sign in as the seeded admin", async ({ page }) => {
  await page.goto("/en/login");
  await page.getByLabel("Email").fill(process.env.VIDYAM_SEED_ADMIN_EMAIL ?? "admin@vidyam.local");
  await page.getByLabel("Password").fill(process.env.VIDYAM_SEED_ADMIN_PASSWORD ?? "change-me-locally-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /^Welcome, / })).toBeVisible();
  await page.context().storageState({ path: ADMIN_STATE });
});
