/**
 * What a printed document says, worked out once for every format (plan v3 step 29): the PDF and both Word
 * files are drawn from this, so they always agree on numbering, the booklet set's order of questions and
 * options, the answer key and the header. Text stays as written (Markdown with $…$ mathematics); each
 * renderer draws it. Pure; no I/O.
 */
import type {
  Answer,
  LocalizedText,
  NotesDocument,
  OrgBranding,
  PaperDocument,
  QuestionContent,
  QuestionType,
} from "@vidyam/contracts";

export type Language = "hi" | "en";
export type Variant = "paper" | "answer_key" | "solutions";

export interface PrintQuestion {
  qtype: QuestionType;
  content: QuestionContent;
  answer: Answer;
}

export interface PrintRequest {
  content: PaperDocument | NotesDocument;
  questions: Readonly<Record<string, PrintQuestion>>;
  branding: OrgBranding | null;
  examName: string | null;
  variant: Variant;
  setCode: string | null;
}

export interface PrintOption {
  label: string; // as printed: "A", "B", … (a set's own order)
  text: string;
}

export interface PrintVersion {
  language: Language;
  stem: string;
  options: PrintOption[];
  solution: string | null;
}

export interface PrintItem {
  number: number;
  marks: number;
  versions: PrintVersion[]; // in the paper's language order; empty when the slot has no question
  answer: string | null; // as printed in the key: "B", "A, C", "9.8", or a model answer
}

export interface PrintSection {
  title: string;
  note: string; // marks each, negative marking, "attempt any N"
  instructions: string[];
  items: PrintItem[];
}

export interface PrintPaper {
  kind: "paper";
  variant: Variant;
  languages: Language[];
  sideBySide: boolean;
  headerLines: string[]; // the center's name and header lines
  title: string;
  facts: string[]; // exam, set, time, marks
  instructions: string[];
  sections: PrintSection[];
  footer: string | null;
}

export interface PrintNotesSection {
  title: string;
  bodies: { language: Language; markdown: string }[];
  sources: string[];
}

export interface PrintNotes {
  kind: "notes";
  languages: Language[];
  headerLines: string[];
  title: string;
  facts: string[];
  sections: PrintNotesSection[];
  footer: string | null;
}

export type PrintDocument = PrintPaper | PrintNotes;

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

const WORDS: Record<string, { en: string; hi: string }> = {
  exam: { en: "Exam", hi: "परीक्षा" },
  set: { en: "Set", hi: "सेट" },
  time: { en: "Time", hi: "समय" },
  minutes: { en: "minutes", hi: "मिनट" },
  marks: { en: "Maximum marks", hi: "पूर्णांक" },
  questions: { en: "Questions", hi: "प्रश्न" },
  each: { en: "marks each", hi: "अंक प्रत्येक" },
  negative: { en: "negative", hi: "ऋणात्मक" },
  attempt: { en: "attempt any", hi: "कोई भी हल करें" },
  answerKey: { en: "Answer key", hi: "उत्तर कुंजी" },
  solutions: { en: "Solutions", hi: "हल" },
  section: { en: "Section", hi: "खंड" },
  sources: { en: "Sources", hi: "स्रोत" },
}; // prettier-ignore

/** A label in the document's languages: "समय / Time". */
function word(key: string, languages: readonly Language[]): string {
  const { en, hi } = WORDS[key]!;
  return languages.map((language) => (language === "hi" ? hi : en)).join(" / ");
}

/** Localized text in the document's languages, joined: "बहुविकल्पीय / Multiple choice". */
function both(text: LocalizedText | null | undefined, languages: readonly Language[]): string {
  if (!text) return "";
  const parts = languages.map((language) => text[language]).filter((part): part is string => Boolean(part));
  return [...new Set(parts.length ? parts : [text.en ?? text.hi ?? ""])].join(" / ");
}

function linesOf(text: LocalizedText | null | undefined, languages: readonly Language[]): string[] {
  if (!text) return [];
  return languages.flatMap((language) => (text[language] ? text[language]!.split("\n") : []));
}

function number(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function languagesOf(spec: { languages: readonly string[] }): Language[] {
  const chosen = (["hi", "en"] as const).filter((language) => spec.languages.includes(language));
  return chosen.length ? [...chosen] : ["hi"];
}

function header(
  request: PrintRequest,
  languages: Language[],
): { headerLines: string[]; footer: string | null } {
  const branding = request.branding;
  return {
    headerLines: branding
      ? [both(branding.name, languages), ...linesOf(branding.headerLines, languages)]
      : [],
    footer: branding?.footer ? both(branding.footer, languages) : null,
  };
}

/** The printed form of a document, for one variant and booklet set. */
export function printDocument(request: PrintRequest): PrintDocument {
  return "slots" in request.content
    ? printPaper(request, request.content)
    : printNotes(request, request.content);
}

function printPaper(request: PrintRequest, paper: PaperDocument): PrintPaper {
  const spec = paper.spec;
  const languages = languagesOf(spec);
  const set = request.setCode ? (paper.sets.find((s) => s.code === request.setCode) ?? null) : null;
  const bySlot = new Map(paper.slots.map((slot) => [slot.slotId, slot]));
  let count = 0;
  let total = 0;
  const sections: PrintSection[] = paper.sections.map((section, index) => {
    const ids = set ? set.slotOrder.filter((id) => section.slotIds.includes(id)) : section.slotIds;
    const pattern = spec.sections[index];
    const items = ids.flatMap((id): PrintItem[] => {
      const slot = bySlot.get(id);
      if (!slot) return [];
      count += 1;
      total += slot.marks;
      const question = slot.questionId ? request.questions[slot.questionId] : undefined;
      const order = set?.optionOrder[id] ?? null;
      return [
        {
          number: count,
          marks: slot.marks,
          versions: question ? versions(question, languages, order) : [],
          answer: question ? answerText(question, order) : null,
        },
      ];
    });
    const note = pattern
      ? [
          `${number(pattern.marksEach)} ${word("each", languages)}`,
          ...(pattern.negativeMarks
            ? [`${word("negative", languages)} ${number(pattern.negativeMarks)}`]
            : []),
          ...(pattern.attemptAny ? [`${word("attempt", languages)} ${pattern.attemptAny}`] : []),
        ].join(" · ")
      : "";
    return {
      title: both(section.name, languages) || `${word("section", languages)} ${index + 1}`,
      note,
      instructions: linesOf(section.instructions, languages),
      items,
    };
  });
  const titles: Record<Variant, string> = {
    paper: spec.title,
    answer_key: `${spec.title} — ${word("answerKey", languages)}`,
    solutions: `${spec.title} — ${word("solutions", languages)}`,
  };
  const facts = [
    ...(request.examName ? [`${word("exam", languages)}: ${request.examName}`] : []),
    ...(set ? [`${word("set", languages)}: ${set.code}`] : []),
    ...(spec.durationMinutes ? [`${word("time", languages)}: ${spec.durationMinutes} ${word("minutes", languages)}`] : []),
    `${word("marks", languages)}: ${number(total)}`,
    `${word("questions", languages)}: ${count}`,
  ]; // prettier-ignore
  return {
    kind: "paper",
    variant: request.variant,
    languages,
    sideBySide: spec.layout === "side_by_side" && languages.length === 2,
    ...header(request, languages),
    title: titles[request.variant],
    facts,
    instructions:
      request.variant === "paper" ? linesOf(request.branding?.defaultInstructions, languages) : [],
    sections,
  };
}

function versions(question: PrintQuestion, languages: Language[], order: string[] | null): PrintVersion[] {
  return languages.flatMap((language): PrintVersion[] => {
    const text = question.content[language];
    if (!text) return [];
    const keys = order ?? text.options.map((option) => option.key);
    const options = keys.flatMap((key, n): PrintOption[] => {
      const option = text.options.find((o) => o.key === key);
      return option ? [{ label: order ? LETTERS[n]! : option.key, text: option.text }] : [];
    });
    return [{ language, stem: text.stem, options, solution: text.solution }];
  });
}

/** The key as printed in this set: the correct options' positions, the number, or the model answer. */
export function answerText(question: PrintQuestion, order: readonly string[] | null): string | null {
  const answer = question.answer;
  switch (answer.kind) {
    case "options":
      return answer.keys.map((key) => (order ? (LETTERS[order.indexOf(key)] ?? key) : key)).join(", ");
    case "numeric":
      return number(answer.value);
    case "text":
      return answer.modelAnswer || null;
    default:
      return null;
  }
}

function printNotes(request: PrintRequest, notes: NotesDocument): PrintNotes {
  const languages = languagesOf(notes.spec);
  return {
    kind: "notes",
    languages,
    ...header(request, languages),
    title: notes.spec.title,
    facts: request.examName ? [`${word("exam", languages)}: ${request.examName}`] : [],
    sections: notes.sections
      .filter((section) => languages.some((language) => section.body[language]))
      .map((section) => ({
        title: both(section.title, languages),
        bodies: languages.flatMap((language) =>
          section.body[language] ? [{ language, markdown: section.body[language]! }] : [],
        ),
        sources: section.citations.map(
          (source, n) =>
            `[${n + 1}] ${source.filename}${source.pageLabel || source.pageStart ? `, p. ${source.pageLabel ?? source.pageStart}` : ""}`,
        ),
      })),
  };
}

export function sourcesTitle(languages: readonly Language[]): string {
  return word("sources", languages);
}
