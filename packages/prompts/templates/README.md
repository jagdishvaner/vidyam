# Prompt templates

One file per task and model family: `<task>.<family>.md`, where task is one of the LLM tasks in
`packages/contracts/src/llm.ts` and family is `claude`, `gpt` or `any` (used when no family-specific
file exists). The file starts with the variables it uses, then the prompt:

```
---
variables: first_message, language
---
…prompt text using {{first_message}} and {{language}}…
```

`pnpm db:seed` stores each file as a version of that prompt. A new file version goes live by itself only
while the live version also came from these files; when an admin has activated their own version from the
admin panel, the file version is added but left inactive for them to compare and switch.

Prompts for each task are written in the step that builds the task (plan v3 §9) and tuned in phase D.
