import type { Blueprint } from "@vidyam/contracts";
import { describe, expect, it } from "vitest";

import { patternTotals, sameJson, scopeProblems } from "./paper-pattern.js";

const mix = { easy: 0.3, medium: 0.5, hard: 0.2 };
const section = (scope: string[], count = 20, attemptAny: number | null = null) => ({
  name: { en: `Section ${scope.join(",") || "all"}` },
  qtype: "mcq_single" as const,
  count,
  marksEach: 4,
  negativeMarks: 1,
  attemptAny,
  difficultyMix: mix,
  scope,
});
const jee: Blueprint = {
  sections: [section(["physics"]), section(["physics"], 10, 5), section(["chemistry"])],
  durationMinutes: 180,
  instructions: { en: "…" },
  defaultDifficultyMix: mix,
};

describe("paper patterns", () => {
  it("count what a candidate answers: 'attempt any 5 of 10' is 5 questions", () => {
    expect(patternTotals(jee)).toEqual({ totalQuestions: 45, totalMarks: 180 });
  });

  it("let a section draw from a linked node, below it, or the subject above it, but nothing else", () => {
    const known = new Set([
      "physics",
      "physics/mechanics",
      "physics/mechanics/kinematics",
      "chemistry",
      "biology",
    ]);
    expect(scopeProblems(jee, ["physics/mechanics", "chemistry"], known)).toEqual([]);
    const bad = { ...jee, sections: [section(["biology"]), section(["physics/optics"])] };
    expect(scopeProblems(bad, ["physics/mechanics"], known)).toEqual([
      "Section biology: biology is outside this exam paper's syllabus",
      "Section physics/optics: physics/optics isn't in the syllabus",
    ]);
  });

  it("compare stored and new patterns regardless of key order", () => {
    expect(sameJson({ a: 1, b: [{ x: 1, y: 2 }] }, { b: [{ y: 2, x: 1 }], a: 1 })).toBe(true);
    expect(sameJson({ a: 1 }, { a: 2 })).toBe(false);
  });
});
