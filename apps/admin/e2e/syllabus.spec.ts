import { expect, test } from "@playwright/test";

/** A small subject the test can import again and again (imports update by code path, so nothing piles up). */
const SYLLABUS = {
  subject: {
    code: "e2e_test_subject",
    level: "subject",
    nameEn: "E2E Test Subject",
    nameHi: "परीक्षण विषय",
    children: [
      {
        code: "unit_a",
        level: "unit",
        nameEn: "Unit A",
        nameHi: "इकाई क",
        children: [
          {
            code: "chapter_one",
            level: "chapter",
            nameEn: "Chapter One",
            nameHi: "पहला अध्याय",
            children: [{ code: "topic_x", level: "topic", nameEn: "Topic X", nameHi: "प्रकरण क्ष" }],
          },
        ],
      },
    ],
  },
};
const EXAMS = [
  {
    code: "e2e_test_paper",
    family: "e2e",
    paperCode: null,
    nameEn: "E2E Test Paper",
    nameHi: null,
    authoritativeLanguage: "en",
    syllabus: [{ node: "e2e_test_subject/unit_a" }],
  },
];
const file = (name: string, json: unknown) => ({
  name,
  mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify(json)),
});

test("admin imports a syllabus, edits a topic, and imports then deletes an exam paper", async ({ page }) => {
  await page.goto("/en/exams");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import syllabus (JSON)" }).click();
  await (await chooser).setFiles(file("syllabus.json", SYLLABUS));
  await expect(page.getByText(/^Imported: /)).toBeVisible();

  await page.getByRole("button", { name: /^E2E Test Subject/ }).click();
  // Units open by default so chapters show; a chapter's topics open on demand.
  await expect(page.getByText("Chapter One")).toBeVisible();
  await expect(page.getByText("Topic X")).toHaveCount(0);
  await page.getByRole("button", { name: "Expand Chapter One" }).click();
  await expect(page.getByText("Topic X")).toBeVisible();

  await page.getByRole("button", { name: "Edit: Topic X" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("e2e_test_subject/unit_a/chapter_one/topic_x")).toBeVisible();
  await dialog.getByLabel("Other names teachers type").fill("topic ex\ntopic x ka niyam");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("2 aliases")).toBeVisible();
  await page.screenshot({ path: "test-results/syllabus.png", fullPage: true });

  await page.getByRole("tab", { name: "Exam papers" }).click();
  const examChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import exam papers (JSON)" }).click();
  await (await examChooser).setFiles(file("exams.json", EXAMS));
  const row = page.getByRole("row").filter({ hasText: "E2E Test Paper" });
  await expect(row.getByText("Unit A")).toBeVisible();
  await page.screenshot({ path: "test-results/exam-papers.png", fullPage: true });
  await row.getByRole("button", { name: "Delete: E2E Test Paper" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("E2E Test Paper was deleted")).toBeVisible();
  await expect(row).toHaveCount(0);

  // Retire the test subject so it stays out of the staff and chat pickers (the next run imports it again).
  await page.getByRole("tab", { name: "Syllabus" }).click();
  await page.getByRole("button", { name: /^E2E Test Subject/ }).click();
  await page.getByRole("button", { name: "Edit: E2E Test Subject" }).click();
  const inUse = page.getByRole("dialog").getByRole("switch", { name: /In use/ });
  if ((await inUse.getAttribute("aria-checked")) === "true") await inUse.click();
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: /^E2E Test Subject/ })).toHaveClass(/opacity-50/);
});
