import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

import base from "../eslint/base.mjs";
import cleanArchitecture from "../eslint/clean-architecture.mjs";
import noLlmSdks from "../eslint/no-llm-sdks.mjs";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

async function ruleIdsByFile() {
  const eslint = new ESLint({
    cwd: fixtures,
    overrideConfigFile: true,
    overrideConfig: [...base, ...cleanArchitecture, ...noLlmSdks],
  });
  const results = await eslint.lintFiles(["src/**/*.ts"]);
  return Object.fromEntries(
    results.map((r) => [
      path.relative(path.join(fixtures, "src/modules/demo"), r.filePath),
      r.messages.map((m) => m.ruleId ?? `fatal: ${m.message}`),
    ]),
  );
}

test("clean-architecture layers and the AI-SDK ban are enforced", async () => {
  const got = await ruleIdsByFile();
  assert.deepEqual(got, {
    "application/create-question.ts": [],
    "application/imports-infrastructure.ts": ["boundaries/dependencies"],
    "demo.module.ts": [],
    "domain/imports-external.ts": ["boundaries/dependencies"],
    "domain/imports-infrastructure.ts": ["boundaries/dependencies"],
    "domain/question.ts": [],
    "infrastructure/question-repository.ts": [],
    "interface/imports-infrastructure.ts": ["boundaries/dependencies"],
    "interface/imports-llm-sdk.ts": ["no-restricted-imports"],
    "interface/question-controller.ts": [],
  });
});
