import type { Blueprint, DifficultyMix, PaperSection, QuestionType } from "@vidyam/contracts";

/** The editor works on strings (what inputs hold) and converts to a Blueprint on save. */
export interface MixDraft {
  easy: string;
  medium: string;
  hard: string;
}

export interface SectionDraft {
  nameEn: string;
  nameHi: string;
  qtype: QuestionType;
  count: string;
  marksEach: string;
  negativeMarks: string;
  attemptAny: string;
  scope: string[];
  mix: MixDraft;
}

export interface PatternDraft {
  name: string;
  durationMinutes: string;
  instructionsHi: string;
  instructionsEn: string;
  mix: MixDraft;
  sections: SectionDraft[];
}

const percent = (share: number) => String(Math.round(share * 100));
const mixDraft = (mix: DifficultyMix): MixDraft => ({
  easy: percent(mix.easy),
  medium: percent(mix.medium),
  hard: percent(mix.hard),
});
export const DEFAULT_MIX: MixDraft = { easy: "30", medium: "50", hard: "20" };

export function newSection(mix: MixDraft = DEFAULT_MIX): SectionDraft {
  return {
    nameEn: "",
    nameHi: "",
    qtype: "mcq_single",
    count: "25",
    marksEach: "1",
    negativeMarks: "0",
    attemptAny: "",
    scope: [],
    mix: { ...mix },
  };
}

export function toDraft(name: string, blueprint: Blueprint | null): PatternDraft {
  if (!blueprint) {
    return {
      name,
      durationMinutes: "60",
      instructionsHi: "",
      instructionsEn: "",
      mix: { ...DEFAULT_MIX },
      sections: [newSection()],
    };
  }
  return {
    name,
    durationMinutes: String(blueprint.durationMinutes),
    instructionsHi: blueprint.instructions.hi ?? "",
    instructionsEn: blueprint.instructions.en ?? "",
    mix: mixDraft(blueprint.defaultDifficultyMix),
    sections: blueprint.sections.map((s: PaperSection) => ({
      nameEn: s.name.en ?? "",
      nameHi: s.name.hi ?? "",
      qtype: s.qtype,
      count: String(s.count),
      marksEach: String(s.marksEach),
      negativeMarks: String(s.negativeMarks),
      attemptAny: s.attemptAny === null ? "" : String(s.attemptAny),
      scope: s.scope,
      mix: mixDraft(s.difficultyMix),
    })),
  };
}

function toMix(mix: MixDraft): DifficultyMix | null {
  const [easy, medium, hard] = [mix.easy, mix.medium, mix.hard].map(Number) as [number, number, number];
  if ([easy, medium, hard].some((n) => !Number.isFinite(n) || n < 0) || easy + medium + hard !== 100)
    return null;
  return { easy: easy / 100, medium: medium / 100, hard: hard / 100 };
}

const text = (value: string) => value.trim() || undefined;

/** The Blueprint, or the first thing wrong with the draft (as a message key under `patterns`). */
export function toBlueprint(draft: PatternDraft): { blueprint: Blueprint } | { error: "mixMustAdd" } {
  const defaultMix = toMix(draft.mix);
  const sections: PaperSection[] = [];
  for (const s of draft.sections) {
    const difficultyMix = toMix(s.mix);
    if (!difficultyMix) return { error: "mixMustAdd" };
    sections.push({
      name: { en: text(s.nameEn), hi: text(s.nameHi) },
      qtype: s.qtype,
      count: Number(s.count),
      marksEach: Number(s.marksEach),
      negativeMarks: Number(s.negativeMarks || 0),
      attemptAny: s.attemptAny.trim() ? Number(s.attemptAny) : null,
      difficultyMix,
      scope: s.scope,
    });
  }
  if (!defaultMix) return { error: "mixMustAdd" };
  return {
    blueprint: {
      sections,
      durationMinutes: Number(draft.durationMinutes),
      instructions: { hi: text(draft.instructionsHi), en: text(draft.instructionsEn) },
      defaultDifficultyMix: defaultMix,
    },
  };
}

/** Live totals for the editor footer (what a candidate answers). */
export function draftTotals(draft: PatternDraft): { questions: number; marks: number } {
  let questions = 0;
  let marks = 0;
  for (const s of draft.sections) {
    const answered = Number(s.attemptAny.trim() ? s.attemptAny : s.count) || 0;
    questions += answered;
    marks += answered * (Number(s.marksEach) || 0);
  }
  return { questions, marks: Math.round(marks * 100) / 100 };
}
