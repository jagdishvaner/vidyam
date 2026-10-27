/**
 * Prompt templates shipped with the code: `templates/<task>.<family>.md`, where family is claude, gpt or any.
 * A file starts with a front-matter block naming its variables, then the prompt, which refers to them as
 * {{name}}:
 *
 *     ---
 *     variables: first_message, language
 *     ---
 *     Give this chat a short title…
 *
 * `pnpm db:seed` stores each file as a prompt version; admins can write newer versions in the admin panel.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { LlmTask, PromptFamily } from "@vidyam/contracts";

export const TEMPLATES_DIR = path.join(import.meta.dirname, "..", "templates");

export interface PromptTemplate {
  name: LlmTask;
  modelFamily: PromptFamily;
  variables: string[];
  body: string;
}

const FILE = /^([a-z_]+)\.(claude|gpt|any)\.md$/;
const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n/;
const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** Every template, checked: a known task and family, and every {{placeholder}} declared (and used). */
export function loadPromptTemplates(dir = TEMPLATES_DIR): PromptTemplate[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".md") && file !== "README.md")
    .sort()
    .map((file) => parseTemplate(file, readFileSync(path.join(dir, file), "utf8")));
}

export function parseTemplate(file: string, text: string): PromptTemplate {
  const match = FILE.exec(file);
  if (!match) throw new Error(`${file}: name it <task>.<claude|gpt|any>.md`);
  const name = LlmTask.safeParse(match[1]);
  if (!name.success) throw new Error(`${file}: "${match[1]}" is not an LLM task`);
  const front = FRONT_MATTER.exec(text);
  if (!front) throw new Error(`${file}: starts with a ---/--- block listing its variables`);
  const declared = /^variables:\s*(.*)$/m.exec(front[1]!)?.[1] ?? "";
  const variables = declared
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const body = text.slice(front[0].length).trim();
  const used = new Set([...body.matchAll(PLACEHOLDER)].map((m) => m[1]!));
  const undeclared = [...used].filter((v) => !variables.includes(v));
  const unused = variables.filter((v) => !used.has(v));
  if (undeclared.length) throw new Error(`${file}: {{${undeclared.join("}}, {{")}}} not declared`);
  if (unused.length) throw new Error(`${file}: declared but not used: ${unused.join(", ")}`);
  return { name: name.data, modelFamily: PromptFamily.parse(match[2]), variables, body };
}

/** Fills the placeholders; a missing value is an error rather than a silently empty prompt. */
export function renderPrompt(body: string, values: Record<string, string>): string {
  return body.replace(PLACEHOLDER, (_, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`no value for {{${name}}}`);
    return value;
  });
}
