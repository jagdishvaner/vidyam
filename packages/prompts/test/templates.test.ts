import { describe, expect, it } from "vitest";

import { loadPromptTemplates, parseTemplate, renderPrompt } from "../src/index.js";

describe("prompt templates", () => {
  it("all load, with known tasks and declared variables", () => {
    const templates = loadPromptTemplates();
    expect(templates.map((t) => `${t.name}.${t.modelFamily}`)).toContain("chat_title.any");
  });

  it("refuse undeclared or unused variables and unknown tasks", () => {
    const head = (vars: string) => `---\nvariables: ${vars}\n---\n`;
    expect(() => parseTemplate("chat_title.any.md", `${head("a")}Hello {{b}}`)).toThrow(
      /\{\{b\}\} not declared/,
    );
    expect(() => parseTemplate("chat_title.any.md", `${head("a, b")}Hello {{a}}`)).toThrow(/not used: b/);
    expect(() => parseTemplate("dance.any.md", `${head("")}Hello`)).toThrow(/not an LLM task/);
    expect(() => parseTemplate("chat_title.llama.md", "x")).toThrow(/name it/);
  });

  it("render every placeholder or fail loudly", () => {
    expect(renderPrompt("Hi {{name}}, {{ name }}!", { name: "Asha" })).toBe("Hi Asha, Asha!");
    expect(() => renderPrompt("Hi {{name}}", {})).toThrow(/no value for \{\{name\}\}/);
  });
});
