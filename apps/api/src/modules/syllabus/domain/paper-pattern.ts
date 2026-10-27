import type { Blueprint } from "@vidyam/contracts";

/** Questions a candidate answers and the marks they can score ("attempt any N" counts N). */
export function patternTotals(blueprint: Blueprint): { totalQuestions: number; totalMarks: number } {
  let totalQuestions = 0;
  let totalMarks = 0;
  for (const section of blueprint.sections) {
    const answered = section.attemptAny ?? section.count;
    totalQuestions += answered;
    totalMarks += answered * section.marksEach;
  }
  return { totalQuestions, totalMarks: Math.round(totalMarks * 100) / 100 };
}

/**
 * A section may draw from any part of the paper's syllabus: a linked node, something below it, or a subject or
 * unit above it (then only the linked parts count). Anything else is outside the paper.
 */
export function scopeProblems(
  blueprint: Blueprint,
  paperSyllabus: string[],
  knownPaths: Set<string>,
): string[] {
  const problems: string[] = [];
  for (const [i, section] of blueprint.sections.entries()) {
    for (const scope of section.scope) {
      const name = section.name.en ?? section.name.hi ?? `section ${i + 1}`;
      if (!knownPaths.has(scope)) problems.push(`${name}: ${scope} isn't in the syllabus`);
      else if (!paperSyllabus.some((linked) => related(scope, linked))) {
        problems.push(`${name}: ${scope} is outside this exam paper's syllabus`);
      }
    }
  }
  return problems;
}

const related = (a: string, b: string) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

/** Deep equality for JSON documents whose key order may differ (Postgres jsonb reorders keys). */
export function sameJson(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
