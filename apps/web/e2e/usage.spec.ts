import { expect, test } from "@playwright/test";

test("admin sets the center's monthly AI budget and sees spend against it", async ({ page }) => {
  await page.goto("/en/admin/usage");
  await expect(page.getByText("Spent", { exact: true })).toBeVisible();

  const budget = page.locator("[data-slot=card]").filter({ hasText: "Center budget" });
  await budget.getByLabel("Monthly limit (US$)").fill("100");
  await budget.getByLabel("Warn at (% of the limit)").fill("80");
  await budget.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("of $100.00 budget")).toBeVisible();
  await expect(page.getByText("Within budget")).toBeVisible();
  await page.screenshot({ path: "test-results/usage.png", fullPage: true });

  // Back to no limit, so the next run starts the same way.
  await budget.getByLabel("Monthly limit (US$)").fill("");
  await budget.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("No center budget set")).toBeVisible();
});
