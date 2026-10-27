import { expect, test } from "@playwright/test";

test("admin sees provider keys, routes a job to another model and back, and manages the registry", async ({
  page,
}) => {
  await page.goto("/en/admin/models");
  await expect(page.getByText("Provider keys")).toBeVisible();
  // No keys in local development: the stub answers, and the page says so.
  await expect(page.getByText(/The built-in test model is answering/)).toBeVisible();

  const job = page.getByRole("row").filter({ hasText: "Write questions" });
  await job.getByRole("button", { name: "Change: Write questions" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Model", { exact: true }).click();
  await page.getByRole("option", { name: "Claude Sonnet 5.5" }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(job.getByText("Your center")).toBeVisible();
  await expect(job.getByText("Claude Sonnet 5.5")).toBeVisible();
  await page.screenshot({ path: "test-results/ai-models.png", fullPage: true });
  await job.getByRole("button", { name: "Use default: Write questions" }).click();
  await expect(job.getByText("Default")).toBeVisible();

  // The seeded admin is the platform admin, so the shared registry is editable here.
  const haiku = page.getByRole("switch", { name: "Teachers can pick: Claude Haiku 5.5" });
  await haiku.click();
  await expect(haiku).toHaveAttribute("aria-checked", "true");
  await haiku.click();
  await expect(haiku).toHaveAttribute("aria-checked", "false");
});
