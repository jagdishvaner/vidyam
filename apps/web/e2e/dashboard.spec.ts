import { expect, test } from "@playwright/test";

/**
 * The dashboards (plan v3 step 30) on the running stack: everyone gets quick actions, recent chats and
 * documents and their own AI use; admins also get the center's spend, content coverage and backlogs. Reads
 * only: nothing is made or changed here.
 */

const SHOTS = process.env.VIDYAM_E2E_SHOTS;

test("an admin sees their work, their AI use and the center's", async ({ page }) => {
  await page.goto("/en");
  await expect(page.getByText("Recent chats", { exact: true })).toBeVisible();
  await expect(page.getByText("Papers and notes", { exact: true })).toBeVisible();
  await expect(page.getByText("My AI use this month")).toBeVisible();
  await expect(page.getByText("Center's AI spend this month")).toBeVisible();
  await expect(page.getByText("Content coverage", { exact: true })).toBeVisible();
  // Every subject of the syllabus is listed, with its chapters (the dev library may be empty).
  await expect(page.getByRole("table", { name: "Content coverage" }).getByRole("row")).not.toHaveCount(0);
  await expect(page.getByText("Waiting to be processed")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dashboard.png`, fullPage: true });

  await page.getByRole("link", { name: "Make a paper" }).click();
  await expect(page).toHaveURL(/\/en\/chat\?prompt=/);
  await expect(page.getByLabel("Message")).toHaveValue("Make a question paper on ");
});

test("a teacher sees their own work and use, and none of the center's", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/en/login");
  await page.getByLabel("Email").fill("teacher@vidyam.local");
  await page.getByLabel("Password").fill(process.env.VIDYAM_SEED_DEMO_PASSWORD ?? "demo-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("My AI use this month")).toBeVisible();
  await expect(page.getByText("Recent chats", { exact: true })).toBeVisible();
  await expect(page.getByText("Center's AI spend this month")).toHaveCount(0);
  await expect(page.getByText("Content coverage", { exact: true })).toHaveCount(0);
  await context.close();
});
