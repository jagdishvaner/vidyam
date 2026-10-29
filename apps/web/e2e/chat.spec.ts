import { expect, test, type Page } from "@playwright/test";

/**
 * The chat (plan v3 step 24) on the running stack, with the built-in stub model: a paper request goes to the
 * review card and Confirm, a vague one asks on a card, a doubt the library can't answer says so, and chats can
 * be renamed and deleted. Every chat made here is deleted at the end.
 */

const SHOTS = process.env.VIDYAM_E2E_SHOTS;
const made: string[] = [];

async function newChat(page: Page, locale = "en") {
  await page.goto(`/${locale}/chat`);
  await expect(page.getByLabel(locale === "en" ? "Message" : "संदेश")).toBeVisible();
}

async function send(page: Page, text: string) {
  await page.getByLabel("Message").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

async function chatId(page: Page): Promise<string> {
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  const id = page.url().split("/").pop()!;
  if (!made.includes(id)) made.push(id);
  return id;
}

test.afterAll(async ({ request }) => {
  for (const id of made) await request.delete(`/api/chat/sessions/${id}`);
});

test("a paper request goes to the review card, and Confirm makes it", async ({ page }) => {
  await newChat(page);
  await expect(page.getByText("What shall we work on?")).toBeVisible();
  await send(page, "RPSC 2nd grade science paper on gati ke niyam, 30 questions");

  await expect(page.getByText("Here is what I'll make", { exact: false })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Force and Laws of Motion").first()).toBeVisible();
  await expect(page.getByText("30 questions, 60 marks")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Multiple choice" })).toBeVisible();
  await chatId(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/chat-review.png`, fullPage: true });

  // Confirm makes the paper (step 26). The dev library is empty, so every question is marked as wanting
  // material instead of being invented, and the chat says so when the run ends, without a reload.
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Confirmed")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Confirm" })).toHaveCount(0); // the old card is no longer live
  await expect(page.getByText("I couldn't make any of it", { exact: false })).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByText("v1")).toBeVisible();
  await expect(page.getByText("Finished")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/chat-made.png`, fullPage: true });
});

test("a vague request asks on a card, and the answer completes it", async ({ page }) => {
  await newChat(page);
  await send(page, "ek paper banao motion par");
  await expect(page.getByText("What should it cover?")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("How should the paper look?")).toBeVisible();
  await chatId(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/chat-cards.png`, fullPage: true });

  // Pick one of the chapters "motion" could mean, and an exam with a paper pattern.
  await page.getByRole("button", { name: /^\+ / }).first().click();
  await page.getByRole("combobox", { name: "Exam" }).click();
  await page.getByRole("option", { name: "RPSC Senior Teacher (2nd Grade), Paper II: Science" }).click();
  await page.getByRole("button", { name: "Continue" }).first().click();
  await expect(page.getByText("Here is what I'll make", { exact: false })).toBeVisible({ timeout: 30_000 });
});

test("a doubt the library can't answer says so instead of guessing", async ({ page }) => {
  await newChat(page);
  await send(page, "newton ka teesra niyam kya hai?");
  await expect(
    page.getByText("I couldn't find this in your center's material", { exact: false }),
  ).toBeVisible({
    timeout: 60_000,
  });
  await chatId(page);
});

test("chats are renamed, found and deleted from the history", async ({ page }) => {
  await newChat(page);
  await send(page, "hello");
  const id = await chatId(page);
  await expect(page.getByText("Stub answer", { exact: false })).toBeVisible({ timeout: 30_000 });

  const history = page.getByRole("complementary", { name: "Chat history" });
  const row = history.locator("div.group").filter({ has: page.locator(`a[href$="/chat/${id}"]`) });
  await row.hover();
  await row.getByRole("button", { name: "Chat options" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByLabel("Chat name").fill("Greeting test");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("link", { name: "Greeting test" })).toBeVisible();

  await page.getByPlaceholder("Search chats").fill("Greeting test");
  await expect(history.getByRole("link")).toHaveCount(2); // New chat, and the one chat that matches

  await row.hover();
  await row.getByRole("button", { name: "Chat options" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("link", { name: "Greeting test" })).toHaveCount(0);
  await expect(page).toHaveURL(/\/en\/chat$/);
});

test("the chat speaks Hindi", async ({ page }) => {
  await newChat(page, "hi");
  await expect(page.getByText("आज क्या बनाएँ?")).toBeVisible();
  await expect(page.getByRole("link", { name: "नई चैट" })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/chat-hindi.png`, fullPage: true });
});
