import { describe, expect, it } from "vitest";

import { canNest, flattenTree } from "./syllabus-tree.js";

const node = (code: string, level: string, children: unknown[] = []) =>
  ({ code, level, nameEn: code, nameHi: null, aliases: [], objectives: [], children }) as never;

describe("syllabus tree", () => {
  it("lists nodes parents-first with their code paths and sibling order", () => {
    const { nodes, problems } = flattenTree(
      node("science", "subject", [
        node("physics", "unit", [node("motion", "chapter"), node("force", "chapter")]),
      ]),
    );
    expect(problems).toEqual([]);
    expect(nodes.map((n) => [n.path, n.parentPath, n.sortOrder])).toEqual([
      ["science", null, 0],
      ["science/physics", "science", 0],
      ["science/physics/motion", "science/physics", 0],
      ["science/physics/force", "science/physics", 1],
    ]);
  });

  it("lets levels be skipped but never reversed, and catches duplicate codes", () => {
    expect(canNest("subject", "chapter")).toBe(true);
    expect(canNest("chapter", "unit")).toBe(false);
    expect(canNest(null, "chapter")).toBe(false);
    const { problems } = flattenTree(
      node("science", "subject", [node("motion", "chapter", [node("x", "unit")]), node("motion", "chapter")]),
    );
    expect(problems).toEqual([
      "science/motion/x: a unit can't sit under a chapter",
      "science/motion: the same code appears twice here",
    ]);
  });
});
