import { expect, test, type Page } from "@playwright/test";

const ADMIN = {
  email: process.env.VIDYAM_SEED_ADMIN_EMAIL ?? "admin@vidyam.local",
  password: process.env.VIDYAM_SEED_ADMIN_PASSWORD ?? "change-me-locally-123",
  name: process.env.VIDYAM_SEED_ADMIN_NAME ?? "Vidyam Admin",
};
const ORG = process.env.VIDYAM_SEED_ORG_NAME ?? "Vidyam Demo Coaching";

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/en/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("visitors are sent to sign-in, and a wrong password is refused", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/en\/login/);
    await signIn(page, ADMIN.email, "definitely-not-it");
    await expect(page.getByRole("alert").filter({ hasText: "don't match" })).toBeVisible();
  });
});

test("admin sees a live dashboard, in English and Hindi", async ({ page }) => {
  await page.goto("/en");
  await expect(page.getByRole("heading", { name: `Welcome, ${ADMIN.name}` })).toBeVisible();
  await expect(page.getByText(`Platform admin at ${ORG}`)).toBeVisible();
  await expect(page.getByText("All systems operational")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("qdrant")).toBeVisible();
  await page.screenshot({ path: "test-results/dashboard-en.png", fullPage: true });

  await page.getByRole("button", { name: "Language" }).click();
  await expect(page).toHaveURL(/\/hi$/);
  await expect(page.getByRole("heading", { name: `स्वागत है, ${ADMIN.name}` })).toBeVisible();
  await expect(page.getByText("सभी सेवाएँ ठीक चल रही हैं")).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: "test-results/dashboard-hi.png", fullPage: true });
});

test("the old Members address and the Admin link lead to the admin panel", async ({ page }) => {
  const admin = process.env.VIDYAM_ADMIN_URL ?? "http://localhost:38001";
  await page.goto("/en/settings/members");
  await expect(page).toHaveURL(`${admin}/en/staff`);
  await page.goto("/en");
  await expect(page.getByRole("link", { name: "Admin" })).toHaveAttribute("href", `${admin}/en`);
});
