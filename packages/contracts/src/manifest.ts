import { z } from "zod";

import { CodePath } from "./catalog.js";
import { Licence, SourceKind } from "./common.js";
import { contract } from "./registry.js";

/** A page range in the file and the syllabus chapter it covers ("12-30" → science/physics/motion). */
export const ManifestSection = contract(
  "ManifestSection",
  z.object({
    pages: z.string().regex(/^\d+(-\d+)?$/),
    /** Syllabus code path from the subject, e.g. "science/physics/motion". */
    chapter: CodePath,
    title: z.string().optional(),
  }),
);
export type ManifestSection = z.infer<typeof ManifestSection>;

/**
 * One file's row in an upload manifest (plan v3 §5). Everything search and generation filter on is captured
 * here, once, so content never has to be uploaded again. Folder-level defaults fill in missing columns.
 */
export const SourceManifestRow = contract(
  "SourceManifestRow",
  z
    .object({
      /** Path of the file relative to the manifest. */
      file: z.string().min(1),
      kind: SourceKind,
      licence: Licence,
      /** Syllabus subject code ("science"), or "multi" for a file spanning subjects. */
      subject: z.string().min(1),
      language: z.enum(["hi", "en", "bilingual"]),
      exams: z.array(z.string().min(1)).min(1),
      title: z.string().optional(),
      classLevel: z.string().optional(),
      // Question papers
      paperCode: z.string().optional(),
      year: z.number().int().min(1950).max(2100).optional(),
      setCode: z
        .string()
        .regex(/^[A-Z]$/)
        .optional(),
      dateShift: z.string().optional(),
      // Answer keys
      answerKeyFor: z.string().optional(),
      answerKeyStatus: z.enum(["provisional", "final"]).optional(),
      // Structure: a single-chapter file, or page ranges per chapter
      chapter: CodePath.optional(),
      sections: z.array(ManifestSection).optional(),
      /** The other-language edition of the same book (its file path). */
      parallelOf: z.string().optional(),
      /** Printed number of the PDF's first page, minus one. */
      pageOffset: z.number().int().optional(),
      fontHint: z.enum(["unicode", "krutidev", "chanakya", "other"]).optional(),
      author: z.string().optional(),
      edition: z.string().optional(),
      tags: z.array(z.string()).optional(),
    })
    .superRefine((row, ctx) => {
      const need = (field: keyof typeof row, why: string) => {
        if (row[field] === undefined)
          ctx.addIssue({ code: "custom", path: [field], message: `required ${why}` });
      };
      if (row.kind === "question_paper") {
        need("paperCode", "for a question paper");
        need("year", "for a question paper");
        need("setCode", "for a question paper (its booklet set)");
      }
      if (row.kind === "answer_key") {
        need("answerKeyFor", "for an answer key (the paper it answers)");
        need("setCode", "for an answer key");
        need("answerKeyStatus", "for an answer key");
      }
      if (row.kind === "book") need("title", "for a book");
    }),
);
export type SourceManifestRow = z.infer<typeof SourceManifestRow>;

/** Columns that hold lists in the CSV: "a; b" for exams and tags, "1-4=science/physics/motion; 5-8=…" for sections. */
const LIST_COLUMNS = new Set(["exams", "tags"]);
const NUMBER_COLUMNS = new Set(["year", "pageOffset"]);
const COLUMNS = new Set(Object.keys(SourceManifestRow.shape));

export interface ManifestProblem {
  /** 1-based line in the CSV. */
  line: number;
  file?: string;
  message: string;
}

export interface ParsedManifest {
  rows: SourceManifestRow[];
  problems: ManifestProblem[];
}

/**
 * Reads an upload manifest (CSV, first line = column names, which are the SourceManifestRow fields). A row whose
 * `file` ends in "/" sets defaults for every file under that folder; the closest folder wins, and a file's own
 * cells win over both. Every problem is reported with its line, so a manifest is fixed in one pass.
 */
export function parseManifestCsv(text: string): ParsedManifest {
  const [header, ...records] = parseCsv(text);
  const problems: ManifestProblem[] = [];
  if (!header) return { rows: [], problems: [{ line: 1, message: "the manifest is empty" }] };
  const names = header.values.map((name) => name.trim());
  for (const name of names) {
    if (!COLUMNS.has(name)) problems.push({ line: 1, message: `unknown column "${name}"` });
  }
  if (!names.includes("file"))
    return { rows: [], problems: [{ line: 1, message: 'a "file" column is required' }] };

  const folders = new Map<string, Record<string, unknown>>();
  const files: { line: number; cells: Record<string, unknown> }[] = [];
  for (const { line, values } of records) {
    if (values.every((v) => v.trim() === "")) continue;
    const cells: Record<string, unknown> = {};
    names.forEach((name, i) => {
      const value = values[i]?.trim() ?? "";
      if (value === "" || !COLUMNS.has(name)) return;
      if (LIST_COLUMNS.has(name)) cells[name] = splitList(value);
      else if (NUMBER_COLUMNS.has(name)) cells[name] = /^-?\d+$/.test(value) ? Number(value) : value;
      else if (name === "sections") cells[name] = splitList(value).map(parseSection);
      else cells[name] = value;
    });
    const file = String(cells.file ?? "");
    if (file.endsWith("/")) folders.set(file, cells);
    else files.push({ line, cells });
  }

  const rows: SourceManifestRow[] = [];
  const seen = new Set<string>();
  for (const { line, cells } of files) {
    const file = String(cells.file ?? "");
    if (seen.has(file)) problems.push({ line, file, message: "listed twice" });
    seen.add(file);
    const defaults = [...folders.keys()]
      .filter((folder) => file.startsWith(folder))
      .sort((a, b) => a.length - b.length)
      .map((folder) => folders.get(folder));
    const merged = Object.assign({}, ...defaults, cells, { file }) as Record<string, unknown>;
    const parsed = SourceManifestRow.safeParse(merged);
    if (parsed.success) rows.push(parsed.data);
    else {
      for (const issue of parsed.error.issues) {
        problems.push({ line, file, message: `${issue.path.join(".") || "row"}: ${issue.message}` });
      }
    }
  }
  return { rows, problems };
}

function splitList(value: string): string[] {
  return value
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseSection(value: string): { pages: string; chapter: string } {
  const [pages = "", chapter = ""] = value.split("=").map((part) => part.trim());
  return { pages, chapter };
}

/** RFC 4180: quoted cells may hold commas, quotes ("") and line breaks. Lines are counted for messages. */
function parseCsv(text: string): { line: number; values: string[] }[] {
  const records: { line: number; values: string[] }[] = [];
  let values: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let start = 1;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else {
        if (ch === "\n") line++;
        cell += ch;
      }
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      values.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      values.push(cell);
      records.push({ line: start, values });
      values = [];
      cell = "";
      line++;
      start = line;
    } else cell += ch;
  }
  if (cell !== "" || values.length) {
    values.push(cell);
    records.push({ line: start, values });
  }
  return records;
}
