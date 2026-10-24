/** Conventional Commits, e.g. "feat(api): add paper versions", "fix(ai): handle Kruti Dev reph". */
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2,
      "always",
      [
        "web",
        "api",
        "ai",
        "render",
        "contracts",
        "db",
        "ui",
        "config",
        "prompts",
        "infra",
        "ci",
        "docs",
        "deps",
        "evals",
      ],
    ],
  },
};
