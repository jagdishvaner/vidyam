import { expect, test } from "@playwright/test";

test("a person sets their own defaults and language, and a wrong current password is refused", async ({
  page,
}) => {
  await page.goto("/en/settings");
  await expect(page.getByLabel("Your name")).toHaveValue(/.+/);
  await expect(page.getByText("Your subjects")).toBeVisible();

  await page.getByLabel("Language of papers and notes").click();
  await page.getByRole("option", { name: "Hindi", exact: true }).click();
  await page.getByLabel("Exam paper you work on most").click();
  await page.getByRole("option", { name: "RPSC Senior Teacher (2nd Grade), Paper II: Science" }).click();
  await page.getByRole("button", { name: "Save" }).nth(1).click();
  await expect(page.getByText("Saved").first()).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Exam paper you work on most")).toHaveText(/Paper II: Science/);
  await page.screenshot({ path: "test-results/settings.png", fullPage: true });

  // Choosing Hindi for the app moves the page to Hindi at once; then back to English.
  await page.getByLabel("Language of the app").click();
  await page.getByRole("option", { name: "हिन्दी" }).click();
  await page.getByRole("button", { name: "Save" }).nth(1).click();
  await expect(page).toHaveURL(/\/hi\/settings$/);
  await page.getByLabel("ऐप की भाषा").click();
  await page.getByRole("option", { name: "English" }).click();
  await page.getByLabel("प्रश्न-पत्र और नोट्स की भाषा").click();
  await page.getByRole("option", { name: "हिन्दी और अंग्रेज़ी" }).click();
  await page.getByLabel("जिस परीक्षा प्रश्न-पत्र पर आप सबसे ज़्यादा काम करते हैं").click();
  await page.getByRole("option", { name: "कोई नहीं" }).click();
  await page.getByRole("button", { name: "सेव करें" }).nth(1).click();
  await expect(page).toHaveURL(/\/en\/settings$/);

  await page.getByLabel("Current password").fill("not-my-password-at-all");
  await page.getByLabel("New password (at least 10 characters)").fill("another-long-password");
  await page.getByLabel("New password again").fill("another-long-password");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Your current password isn't right.")).toBeVisible();
});
