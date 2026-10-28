import { expect, test } from "@playwright/test";

/** Read-only by design: writing versions is covered by the API tests, and would pile up versions here. */
test("admin reads the live prompt for a job and opens the editor", async ({ page }) => {
  await page.goto("/en/prompts");
  await expect(page.locator("[data-slot=card-title]", { hasText: "Name chats" })).toBeVisible();
  await expect(page.getByText(/Version \d+ · Live/)).toBeVisible();
  await expect(page.getByText(/Shipped with the app|Written by/)).toBeVisible();
  await expect(page.getByText("Reply with the title only.")).toBeVisible();

  await page.getByRole("button", { name: "Write questions" }).click();
  await expect(page.getByText("No prompt yet for this job.")).toBeVisible();

  await page.getByRole("button", { name: "Name chats" }).click();
  await page.getByRole("button", { name: "New version" }).click();
  await expect(page.getByRole("dialog").getByRole("textbox")).toHaveValue(/Reply with the title only\./);
  await page.screenshot({ path: "test-results/prompts.png", fullPage: true });
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
});
