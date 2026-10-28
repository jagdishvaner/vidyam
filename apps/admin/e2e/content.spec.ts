import { expect, test } from "@playwright/test";

test("admin sees each content backlog with its estimate, and nothing runs without something waiting", async ({
  page,
}) => {
  await page.goto("/en/content");
  for (const title of ["Read scanned pages", "Split papers into questions", "Pick syllabus topics"]) {
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  }
  // The local library starts empty: every backlog is empty, so none can be started.
  await expect(page.getByText("0pages waiting")).toBeVisible();
  for (const button of await page.getByRole("button", { name: "Run…" }).all()) {
    await expect(button).toBeDisabled();
  }
  await expect(page.getByText(/Batch API at half price/)).toBeVisible();
  await page.screenshot({ path: "test-results/content.png", fullPage: true });

  await page.goto("/hi/content");
  await expect(page.getByText("स्कैन किए पेज पढ़ें")).toBeVisible();
});
