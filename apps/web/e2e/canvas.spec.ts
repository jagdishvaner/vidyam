import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * The canvas (plan v3 step 27) on the running stack, with the stub model and the empty dev library: a paper
 * made from the chat opens beside it with every item marked as wanting material; the teacher writes one
 * herself, removes another, undoes, and goes back to an earlier version from the history. The chat, the paper
 * and the question written for it are deleted at the end.
 */

const SHOTS = process.env.VIDYAM_E2E_SHOTS;
const made: string[] = [];

async function cleanUp(request: APIRequestContext, chatId: string) {
  const detail = await request.get(`/api/chat/sessions/${chatId}`);
  const documentId = detail.ok() ? ((await detail.json()).session.documentId as string | null) : null;
  if (documentId) await request.delete(`/api/documents/${documentId}`);
  await request.delete(`/api/chat/sessions/${chatId}`);
}

test.afterAll(async ({ request }) => {
  for (const id of made) await cleanUp(request, id);
});

async function makePaper(page: Page) {
  await page.goto("/en/chat");
  await page.getByLabel("Message").fill("RPSC 2nd grade science paper on gati ke niyam, 4 questions");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Here is what I'll make", { exact: false })).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  made.push(page.url().split("/").pop()!);
  await page.getByRole("button", { name: "Confirm" }).click();
}

test("a paper opens on the canvas, is edited by hand, undone and taken back to a version", async ({
  page,
}) => {
  await makePaper(page);
  const canvas = page.getByRole("complementary", { name: "Document" });
  await expect(canvas).toBeVisible({ timeout: 30_000 }); // it opens by itself once the paper exists
  await expect(canvas.getByText("Version 1")).toBeVisible({ timeout: 90_000 });
  const items = canvas.getByRole("listitem", { name: /^Question \d+$/ });
  await expect(items).toHaveCount(4);
  await expect(items.first().getByText("No material")).toBeVisible();

  // Write question 1 by hand.
  await items.first().getByRole("button", { name: "Item options" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const editor = page.getByRole("dialog", { name: "Write the question" });
  await editor.getByLabel("Question").first().fill("बल का SI मात्रक क्या है?");
  for (const [key, text] of [["A", "न्यूटन"], ["B", "जूल"], ["C", "वाट"], ["D", "पास्कल"]]) {
    await editor.getByLabel(`Option ${key}`).first().fill(text!);
  } // prettier-ignore
  await editor.getByRole("checkbox", { name: "A", exact: true }).click();
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(canvas.getByText("Version 2")).toBeVisible();
  await expect(items.first().getByText("Edited by you")).toBeVisible();
  await expect(items.first().getByText("बल का SI मात्रक क्या है?")).toBeVisible();
  await expect(items.first().getByText("Answer: A")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/canvas.png`, fullPage: true });

  // Remove question 2, then undo.
  await items.nth(1).getByRole("button", { name: "Item options" }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  await expect(canvas.getByText("Version 3")).toBeVisible();
  await expect(items).toHaveCount(3);
  await canvas.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(canvas.getByText("Version 4")).toBeVisible();
  await expect(items).toHaveCount(4);

  // Back to version 1 from the history: question 1 is empty again.
  await canvas.getByRole("button", { name: "History", exact: true }).click();
  const history = page.getByRole("dialog", { name: "Versions" });
  await expect(history.getByText("Made by Vidyam")).toBeVisible();
  await history.getByRole("button", { name: /^Version 1/ }).click();
  await expect(history.getByText("change 1 item")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/canvas-history.png`, fullPage: true });
  await history.getByRole("button", { name: "Go back to this version" }).click();
  await page.keyboard.press("Escape");
  await expect(canvas.getByText("Version 5")).toBeVisible();
  await expect(items.first().getByText("No material")).toBeVisible();

  // Closing it leaves the chat; the document card opens it again.
  await canvas.getByRole("button", { name: "Close" }).click();
  await expect(canvas).toHaveCount(0);
  await page.getByRole("button", { name: "Open" }).first().click();
  await expect(canvas.getByText("Version 5")).toBeVisible();
});
