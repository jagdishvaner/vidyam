import { expect, test } from "@playwright/test";

const SYLLABUS = {
  subject: {
    code: "e2e_test_subject",
    level: "subject",
    nameEn: "E2E Test Subject",
    nameHi: "परीक्षण विषय",
    children: [{ code: "unit_a", level: "unit", nameEn: "Unit A", nameHi: "इकाई क" }],
  },
};
const PAPER = {
  code: "e2e_pattern_paper",
  family: "e2e",
  paperCode: null,
  nameEn: "E2E Pattern Paper",
  nameHi: null,
  authoritativeLanguage: "en",
  syllabus: [{ node: "e2e_test_subject/unit_a" }],
};

test("admin builds a paper pattern, edits it into a new version, then retires it", async ({ page }) => {
  // Set-up through the API with the admin's session; the page under test is the pattern editor.
  expect((await page.request.post("/api/syllabus/import", { data: SYLLABUS })).ok()).toBe(true);
  expect((await page.request.post("/api/exams/import", { data: { exams: [PAPER] } })).ok()).toBe(true);
  // A run that failed half-way may have left its pattern behind.
  const leftovers = (await (await page.request.get("/api/patterns")).json()) as {
    id: string;
    examCode: string;
  }[];
  for (const pattern of leftovers.filter((p) => p.examCode === PAPER.code)) {
    await page.request.delete(`/api/patterns/${pattern.id}`);
  }

  await page.goto("/en/patterns");
  await page.getByLabel("Exam paper").click();
  await page.getByRole("option", { name: /^E2E Pattern Paper/ }).click();
  await page.getByRole("button", { name: "New pattern" }).click();
  const editor = page.getByRole("dialog");
  await editor.getByLabel("Pattern name").fill("Unit test");
  await editor.getByLabel("Duration (minutes)").fill("20");
  await editor.getByLabel("Section name (English)").fill("Unit A questions");
  await editor.getByLabel("Questions", { exact: true }).fill("10");
  await editor.getByLabel("Marks each").fill("2");
  await editor.getByLabel("Negative marks").fill("0.5");
  await editor.getByRole("button", { name: "Unit A", exact: true }).click();
  await expect(editor.getByText("10 questions · 20 marks · 20 min")).toBeVisible();
  await page.screenshot({ path: "test-results/pattern-editor.png" });
  await editor.getByRole("button", { name: "Save" }).click();

  const card = page.locator("[data-slot=card]").filter({ hasText: "Unit test" });
  await expect(card.getByText("10 questions · 20 marks · 20 min")).toBeVisible();
  await expect(
    card.getByRole("row").filter({ hasText: "Unit A questions" }).getByText("Unit A", { exact: true }),
  ).toBeVisible();

  await card.getByRole("button", { name: "Edit: Unit test" }).click();
  await page.getByRole("dialog").getByLabel("Questions", { exact: true }).fill("12");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(card.getByText("version 2")).toBeVisible();
  await expect(card.getByText("12 questions · 24 marks · 20 min")).toBeVisible();
  await page.screenshot({ path: "test-results/patterns.png", fullPage: true });

  await card.getByRole("button", { name: "Retire: Unit test" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Retire" }).click();
  await expect(page.getByText("Unit test was retired")).toBeVisible();
  await expect(card).toHaveCount(0);

  const papers = (await (await page.request.get("/api/exams")).json()) as { id: string; code: string }[];
  const paper = papers.find((p) => p.code === PAPER.code)!;
  expect((await page.request.delete(`/api/exams/${paper.id}`)).status()).toBe(204);
});
