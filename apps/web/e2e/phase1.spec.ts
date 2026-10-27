import { expect, test, type Page } from "@playwright/test";

const ADMIN = {
  email: process.env.VIDYAM_SEED_ADMIN_EMAIL ?? "admin@vidyam.local",
  password: process.env.VIDYAM_SEED_ADMIN_PASSWORD ?? "change-me-locally-123",
  name: process.env.VIDYAM_SEED_ADMIN_NAME ?? "Vidyam Admin",
};
const ORG = process.env.VIDYAM_SEED_ORG_NAME ?? "Vidyam Demo Coaching";

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/en/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("visitors are sent to sign-in, and a wrong password is refused", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/en\/login/);
    await signIn(page, ADMIN.email, "definitely-not-it");
    await expect(page.getByRole("alert").filter({ hasText: "don't match" })).toBeVisible();
  });
});

test("admin sees a live dashboard, in English and Hindi", async ({ page }) => {
  await page.goto("/en");
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

test("admin adds a teacher, sets their subjects and budget, resets their password, then removes them", async ({
  page,
  browser,
}) => {
  const teacher = { email: `teacher-${Date.now()}@vidyam.test`, name: "Asha Sharma" };

  // The old Members address still leads to Admin → Staff.
  await page.goto("/en/settings/members");
  await expect(page).toHaveURL(/\/en\/admin\/staff$/);
  await page.getByRole("button", { name: "Add member" }).click();
  await page.getByLabel("Full name").fill(teacher.name);
  await page.getByLabel("Email (their login ID)").fill(teacher.email);
  // Password left empty: the app generates one and shows it once.
  await page.getByRole("dialog").getByRole("button", { name: "Add member" }).click();
  const details = page.getByText(/^Sign-in page: /);
  await expect(details).toBeVisible();
  const password = (await details.textContent())!.match(/Password: (\S+)/)![1]!;
  const row = page.getByRole("row").filter({ hasText: teacher.email });
  await expect(row).toBeVisible();
  await page.screenshot({ path: "test-results/members.png", fullPage: true });

  // Role, subjects (head of department) and a personal AI budget, saved together.
  await row.getByRole("button", { name: `Actions for ${teacher.name}` }).click();
  await page.getByRole("menuitem", { name: "Edit role, subjects & budget" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Role").click();
  await page.getByRole("option", { name: "Reviewer" }).click();
  await dialog.getByLabel("Physics", { exact: true }).check();
  await dialog.getByRole("switch", { name: "Head of department for Physics" }).click();
  await dialog.getByLabel("Monthly AI budget (US$)").fill("20");
  await page.screenshot({ path: "test-results/staff-edit.png" });
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(`Saved changes for ${teacher.name}`)).toBeVisible();
  await expect(row.getByText("Reviewer")).toBeVisible();
  await expect(row.getByText("Physics")).toBeVisible();
  await expect(row.getByText("of $20.00 budget")).toBeVisible();
  await page.screenshot({ path: "test-results/staff.png", fullPage: true });

  const teacherContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const teacherPage = await teacherContext.newPage();
  await signIn(teacherPage, teacher.email, password);
  await expect(teacherPage.getByRole("heading", { name: `Welcome, ${teacher.name}` })).toBeVisible();
  await expect(teacherPage.getByText(`Reviewer at ${ORG}`)).toBeVisible();
  // Only admins see the Admin panel.
  await expect(teacherPage.getByRole("link", { name: "Admin" })).toHaveCount(0);
  await teacherPage.goto("/en/admin/staff");
  await expect(teacherPage.getByText("Only center admins can open the admin panel.")).toBeVisible();
  await teacherContext.close();

  // The admin sets a new password; only the new one works afterwards.
  await row.getByRole("button", { name: `Actions for ${teacher.name}` }).click();
  await page.screenshot({ path: "test-results/members-actions.png" });
  await page.getByRole("menuitem", { name: "Reset password" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Password (at least 10 characters)")
    .fill("a-new-teacher-password");
  await page.getByRole("button", { name: "Set password" }).click();
  await expect(page.getByText(`Password changed for ${teacher.name}`)).toBeVisible();

  const again = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const againPage = await again.newPage();
  await signIn(againPage, teacher.email, password);
  await expect(againPage.getByRole("alert").filter({ hasText: "don't match" })).toBeVisible();
  await signIn(againPage, teacher.email, "a-new-teacher-password");
  await expect(againPage.getByRole("heading", { name: `Welcome, ${teacher.name}` })).toBeVisible();
  await again.close();

  // The teacher leaves: removing them ends their access (and keeps test runs from piling up members).
  await row.getByRole("button", { name: `Actions for ${teacher.name}` }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText(`${teacher.name} was removed`)).toBeVisible();
  await expect(row).toHaveCount(0);
  const gone = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const gonePage = await gone.newPage();
  await signIn(gonePage, teacher.email, "a-new-teacher-password");
  await expect(gonePage.getByRole("alert").filter({ hasText: "don't match" })).toBeVisible();
  await gone.close();
});

test("admin sees the fixed roles and what each may do", async ({ page }) => {
  await page.goto("/en");
  await page.getByRole("link", { name: "Admin" }).click();
  await expect(page).toHaveURL(/\/en\/admin\/staff$/);
  await page.getByRole("link", { name: "Roles & permissions" }).click();
  const approve = page.getByRole("row").filter({ hasText: "Approve questions into the question bank" });
  await expect(approve.getByLabel("Allowed", { exact: true })).toHaveCount(2); // reviewer and admin
  await expect(approve.getByLabel("Not allowed", { exact: true })).toHaveCount(2);
  await page.screenshot({ path: "test-results/roles.png", fullPage: true });
});
