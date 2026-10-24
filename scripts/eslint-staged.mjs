/**
 * Pre-commit: lint staged TypeScript files with the ESLint config of the package each file belongs to
 * (apps/<name> or packages/<name>), so architecture and framework rules apply exactly as in CI.
 * Usage (from lefthook): node scripts/eslint-staged.mjs <repo-relative files...>
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const byPackage = new Map();
for (const file of process.argv.slice(2)) {
  const [scope, name] = file.split("/");
  if (!["apps", "packages"].includes(scope) || !name) continue;
  const pkg = `${scope}/${name}`;
  if (!existsSync(path.join(pkg, "eslint.config.mjs"))) continue;
  byPackage.set(pkg, [...(byPackage.get(pkg) ?? []), path.relative(pkg, file)]);
}

let failed = false;
for (const [pkg, files] of byPackage) {
  const result = spawnSync("pnpm", ["exec", "eslint", "--fix", "--no-warn-ignored", ...files], {
    cwd: pkg,
    stdio: "inherit",
  });
  failed ||= result.status !== 0;
}
process.exit(failed ? 1 : 0);
