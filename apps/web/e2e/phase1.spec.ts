import { expect, test, type Page } from "@playwright/test";

const ADMIN = {
  email: process.env.VIDYAM_SEED_ADMIN_EMAIL ?? "admin@vidyam.local",
  password: process.env.VIDYAM_SEED_ADMIN_PASSWORD ?? "change-me-locally-123",
  name: process.env.VIDYAM_SEED_ADMIN_NAME ?? "Vidyam Admin",
};
const ORG = process.env.VIDYAM_SEED_ORG_NAME ?? "Vidyam Demo Coaching";
const MAILPIT = "http://localhost:38181";

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/en/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("unauthenticated visitors are sent to sign-in, and a wrong password is refused", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/en\/login/);
  await signIn(page, ADMIN.email, "definitely-not-it");
  await expect(page.getByRole("alert").filter({ hasText: "don't match" })).toBeVisible();
});

test("admin signs in to a live dashboard, in English and Hindi", async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await expect(page.getByRole("heading", { name: `Welcome, ${ADMIN.name}` })).toBeVisible();
  await expect(page.getByText(`Platform admin at ${ORG}`)).toBeVisible();
  await expect(page.getByText("All systems operational")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("qdrant")).toBeVisible();
  await page.screenshot({ path: "test-results/dashboard-en.png", fullPage: true });

  await page.getByRole("button", { name: "Language" }).click();
  await expect(page).toHaveURL(/\/hi$/);
  await expect(page.getByRole("heading", { name: `स्वागत है, ${ADMIN.name}` })).toBeVisible();
  await expect(page.getByText("सभी सेवाएँ ठीक चल रही हैं")).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: "test-results/dashboard-hi.png", fullPage: true });
});

test("admin invites a teacher, who joins from the emailed link", async ({ page, browser, request }) => {
  const teacher = {
    email: `teacher-${Date.now()}@vidyam.test`,
    name: "Asha Sharma",
    password: "teacher-password-1",
  };

  await signIn(page, ADMIN.email, ADMIN.password);
  await expect(page.getByRole("heading", { name: `Welcome, ${ADMIN.name}` })).toBeVisible();
  await page.goto("/en/settings/members");
  await page.getByLabel("Email address").fill(teacher.email);
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText(`Invitation sent to ${teacher.email}`)).toBeVisible();
  await expect(page.getByRole("cell", { name: teacher.email })).toBeVisible();
  await page.screenshot({ path: "test-results/members.png", fullPage: true });

  // The invitation email lands in Mailpit locally.
  let inviteUrl: string | undefined;
  await expect
    .poll(async () => {
      const search = await (await request.get(`${MAILPIT}/api/v1/search?query=to:"${teacher.email}"`)).json();
      const id = search.messages?.[0]?.ID;
      if (!id) return undefined;
      const message = await (await request.get(`${MAILPIT}/api/v1/message/${id}`)).json();
      inviteUrl = String(message.Text).match(/https?:\/\/\S+\/invite\/[0-9a-f-]+/)?.[0];
      return inviteUrl;
    })
    .toBeTruthy();

  const teacherContext = await browser.newContext();
  const teacherPage = await teacherContext.newPage();
  await teacherPage.goto(inviteUrl!);
  await expect(teacherPage.getByText("Join your coaching center")).toBeVisible();
  await teacherPage.getByLabel("Your name").fill(teacher.name);
  await teacherPage.getByLabel("Email").fill(teacher.email);
  await teacherPage.getByLabel("Password").fill(teacher.password);
  await teacherPage.getByRole("button", { name: "Create account" }).last().click();
  await expect(teacherPage.getByRole("heading", { name: `Welcome, ${teacher.name}` })).toBeVisible();
  await expect(teacherPage.getByText(`Teacher at ${ORG}`)).toBeVisible();

  // Teachers can't manage members.
  await teacherPage.goto("/en/settings/members");
  await expect(teacherPage.getByText("Only center admins can manage members.")).toBeVisible();
  await teacherContext.close();
});
