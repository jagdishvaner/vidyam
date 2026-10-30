import { expect, test } from "@playwright/test";

/** System health (plan v3 step 31): every service's checks, the workers among them, and recent problems. */
test("admin sees the workers' status and what failed lately", async ({ page }) => {
  await page.goto("/en/health");
  await expect(page.getByText("api-worker", { exact: true })).toBeVisible();
  await expect(page.getByText("render-worker", { exact: true })).toBeVisible();
  await expect(page.getByText("Recent problems", { exact: true })).toBeVisible();
  // The dev center may or may not have had a failure today; either answer is shown.
  await expect(
    page.getByText("Nothing failed in the last day.").or(page.getByRole("list", { name: "Recent problems" })),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/health.png", fullPage: true });
});
