import { expect, test } from "@playwright/test";

test("admin's own change shows up in the audit log, filterable by area", async ({ page }) => {
  // Make a change that is safe to repeat: set the center budget, then clear it again.
  expect(
    (
      await page.request.put("/api/usage/budget", { data: { monthlyLimitUsd: 75, softLimitPct: 80 } })
    ).status(),
  ).toBe(204);
  expect(
    (
      await page.request.put("/api/usage/budget", { data: { monthlyLimitUsd: null, softLimitPct: 80 } })
    ).status(),
  ).toBe(204);

  await page.goto("/en/audit");
  const latest = page.getByRole("row").filter({ hasText: "Changed the center budget" }).first();
  await expect(latest).toBeVisible();
  await expect(latest.getByText("admin@vidyam.local")).toBeVisible();

  await page.getByLabel("Area").click();
  await page.getByRole("option", { name: "Budgets" }).click();
  await expect(page.getByRole("row").filter({ hasText: "Changed the center budget" }).first()).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Changed export branding" })).toHaveCount(0);
  await page.screenshot({ path: "test-results/audit.png", fullPage: true });
});
