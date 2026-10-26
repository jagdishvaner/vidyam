import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

const REPO = path.resolve(process.cwd(), "../..");

test("an imported Kruti Dev file shows up converted, and an admin can remove it", async ({ page }) => {
  // Imported the way the center's files are: with `pnpm ingest`, read by the running workers.
  const folder = mkdtempSync(path.join(tmpdir(), "vidyam-e2e-"));
  const filename = `kruti-notes-${Date.now()}.txt`;
  const typed =
    "Hkkjr dk lafo/kku 26 tuojh 1950 dks ykxw gqvk Fkk vkSj ;g fo'o dk lcls cM+k fyf[kr lafo/kku gS";
  writeFileSync(path.join(folder, filename), `${typed}\n${Date.now()}\n`); // unique content each run
  execFileSync(
    "pnpm",
    [
      "--silent",
      "ingest",
      folder,
      "--kind",
      "notes",
      "--licence",
      "own",
      "--meta",
      "subject=polity",
      "--wait",
    ],
    { cwd: REPO, stdio: "pipe" },
  );

  await page.goto("/en/library");
  const row = page.getByRole("row").filter({ hasText: filename });
  await expect(row).toContainText("Ready");
  await expect(row).toContainText("subject: polity");
  await page.screenshot({ path: "test-results/library.png", fullPage: true });

  await row.getByRole("link", { name: filename }).click();
  await expect(page.getByRole("heading", { name: filename })).toBeVisible();
  await expect(
    page.getByText("भारत का संविधान 26 जनवरी 1950 को लागू हुआ था और यह विश्व का सबसे बड़ा"),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: "Converted from Kruti Dev" })).toBeVisible();
  await page.screenshot({ path: "test-results/library-detail.png", fullPage: true });

  await page.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText(`${filename} was removed`)).toBeVisible();
  await expect(page).toHaveURL(/\/en\/library$/);
  await expect(page.getByRole("row").filter({ hasText: filename })).toHaveCount(0);
});
