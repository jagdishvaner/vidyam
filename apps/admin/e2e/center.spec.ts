import { expect, test } from "@playwright/test";

/** A 1×1 PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("admin sets the center's export branding, logo and AI rules", async ({ page }) => {
  await page.goto("/en/center");
  await page.getByLabel("Center name (English)").fill("Vidyam Demo Coaching");
  await page.getByLabel("Center name (Hindi)").fill("विद्यम डेमो कोचिंग");
  await page.getByLabel("Header lines (English)").fill("Jaipur, Rajasthan");
  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByText("Saved").first()).toBeVisible();
  const preview = page.locator("[data-slot=card]").filter({ hasText: "Export header preview" });
  await expect(preview.getByText("विद्यम डेमो कोचिंग")).toBeVisible();
  await expect(preview.getByText("Jaipur, Rajasthan")).toBeVisible();

  await page
    .getByLabel("Upload logo")
    .setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByText("Logo updated")).toBeVisible();
  await expect(page.getByRole("img", { name: "Logo" })).toBeVisible();

  const rules = page.locator("[data-slot=card]").filter({ hasText: "AI rules" });
  await rules.getByLabel("Where questions come from by default").click();
  await page.getByRole("option", { name: "Always generate fresh questions" }).click();
  await rules.getByRole("button", { name: "Save" }).click();
  await page.reload();
  await expect(rules.getByText("Always generate fresh questions")).toBeVisible();
  await page.screenshot({ path: "test-results/center.png", fullPage: true });

  // Back to the defaults, so the next run starts the same way.
  await rules.getByLabel("Where questions come from by default").click();
  await page.getByRole("option", { name: "Question bank first, then generate the rest" }).click();
  await rules.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Remove logo" }).click();
  await expect(page.getByText("Logo removed")).toBeVisible();
});
