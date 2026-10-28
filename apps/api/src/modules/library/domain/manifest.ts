import type { ManifestProblem, SourceLanguage, SourceManifestRow } from "@vidyam/contracts";

/** What a manifest is checked against: the center's syllabus and exam papers. */
export interface ManifestCatalog {
  /** Subject code → node id (the roots of the syllabus trees). */
  subjects: ReadonlyMap<string, string>;
  /** Code path ("science/physics/motion") → node. */
  nodes: ReadonlyMap<string, { id: string; level: string }>;
  examCodes: ReadonlySet<string>;
}

/** A file already in the library that a manifest row may point at (an answer key's paper, a parallel edition). */
export interface LibraryFile {
  id: string;
  filename: string;
  kind: string;
  setCode: string | null;
  parallelGroupId: string | null;
}

/** Where a row points: another row of this manifest, or a file already in the library. */
export type FileRef = { row: number } | { sourceId: string };

/** A page range of the file and the syllabus node it covers (`meta.structure` of the source). */
export interface PlannedSection {
  pageStart: number;
  pageEnd: number;
  nodeId: string;
  path: string;
  title: string | null;
}

export interface PlannedSource {
  line: number;
  row: SourceManifestRow;
  mimeType: string;
  language: SourceLanguage;
  subjectNodeId: string | null;
  /** The whole file covers this node (single-chapter notes). */
  chapter: { nodeId: string; path: string } | null;
  sections: PlannedSection[];
  answerKeyFor: FileRef | null;
  parallelOf: FileRef | null;
}

export const MULTI_SUBJECT = "multi";
const PAPER_KINDS = new Set(["question_paper", "booklet"]);

/**
 * Checks parsed manifest rows against the syllabus, the exam papers, the files on disk and each other. Every
 * problem is reported, so a manifest is fixed in one pass; nothing is imported while any remain.
 *
 * `mimeTypes` holds each listed file that exists: its type, or null when the pipeline can't read it.
 * `library` finds files already imported, by file name, for answer keys and editions that arrive later.
 */
export function planManifest(
  rows: readonly SourceManifestRow[],
  lines: readonly number[],
  catalog: ManifestCatalog,
  mimeTypes: ReadonlyMap<string, string | null>,
  library: (filename: string) => readonly LibraryFile[],
): { sources: PlannedSource[]; problems: ManifestProblem[] } {
  const problems: ManifestProblem[] = [];
  const sources: PlannedSource[] = [];
  const index = new Map(rows.map((row, i) => [row.file, i]));

  rows.forEach((row, i) => {
    const line = lines[i] ?? 0;
    const problem = (message: string): null => {
      problems.push({ line, file: row.file, message });
      return null;
    };

    const mimeType = mimeTypes.get(row.file);
    if (mimeType === undefined) problem("file not found next to the manifest");
    else if (mimeType === null) problem("this file type can't be read (PDF, Word, text or images only)");

    let subjectNodeId: string | null = null;
    if (row.subject !== MULTI_SUBJECT) {
      subjectNodeId = catalog.subjects.get(row.subject) ?? null;
      if (!subjectNodeId) problem(`subject "${row.subject}" is not in the syllabus`);
    }
    for (const exam of row.exams) {
      if (!catalog.examCodes.has(exam)) problem(`exam paper "${exam}" is not set up (Admin → Exams)`);
    }

    const node = (path: string, what: string): { nodeId: string; path: string } | null => {
      const found = catalog.nodes.get(path);
      if (!found) return problem(`${what} "${path}" is not in the syllabus`);
      if (found.level === "subject") return problem(`${what} "${path}" is a whole subject`);
      if (row.subject !== MULTI_SUBJECT && !path.startsWith(`${row.subject}/`))
        return problem(`${what} "${path}" is not part of subject "${row.subject}"`);
      return { nodeId: found.id, path };
    };

    let chapter: PlannedSource["chapter"] = null;
    const sections: PlannedSection[] = [];
    if (row.chapter && row.sections?.length) problem("give either a chapter or sections, not both");
    else if (row.chapter) chapter = node(row.chapter, "chapter");
    for (const section of row.sections ?? []) {
      const [start, end = start] = section.pages.split("-").map(Number) as [number, number?];
      if (start < 1 || end < start) problem(`section pages "${section.pages}" are not a range`);
      const found = node(section.chapter, "section chapter");
      if (found) sections.push({ pageStart: start, pageEnd: end, ...found, title: section.title ?? null });
    }
    const ordered = [...sections].sort((a, b) => a.pageStart - b.pageStart);
    ordered.slice(1).forEach((section, n) => {
      if (section.pageStart <= ordered[n]!.pageEnd) problem(`sections overlap at page ${section.pageStart}`);
    });

    const ref = (target: string, what: string, fits: (kind: string) => boolean): FileRef | null => {
      const inManifest = index.get(target);
      if (inManifest === i) return problem(`${what} points at the file itself`);
      if (inManifest !== undefined) {
        const other = rows[inManifest]!;
        if (!fits(other.kind)) return problem(`${what} "${target}" is a ${other.kind}`);
        return { row: inManifest };
      }
      const matches = library(target.split("/").pop()!).filter((file) => fits(file.kind));
      if (matches.length === 1) return { sourceId: matches[0]!.id };
      return problem(
        matches.length
          ? `${what} "${target}" matches ${matches.length} files in the library; list it in this manifest`
          : `${what} "${target}" is neither in this manifest nor in the library`,
      );
    };

    const answerKeyFor = row.answerKeyFor
      ? ref(row.answerKeyFor, "answer key for", (kind) => PAPER_KINDS.has(kind))
      : null;
    if (answerKeyFor && "row" in answerKeyFor) {
      const paper = rows[answerKeyFor.row]!;
      if (paper.setCode !== row.setCode)
        problem(`the key is for set ${row.setCode ?? "?"} but the paper is set ${paper.setCode ?? "?"}`);
    }
    const parallelOf = row.parallelOf ? ref(row.parallelOf, "parallel edition", () => true) : null;

    sources.push({
      line,
      row,
      mimeType: mimeType ?? "",
      language: row.language === "bilingual" ? "mixed" : row.language,
      subjectNodeId,
      chapter,
      sections,
      answerKeyFor,
      parallelOf,
    });
  });
  return { sources, problems };
}

/**
 * Import order: a file comes after the files it points at, so an answer key can be linked to its paper's id.
 * References only go one level deep in practice; a cycle (a parallel of a parallel of itself) keeps file order.
 */
export function importOrder(sources: readonly PlannedSource[]): number[] {
  const order: number[] = [];
  const placed = new Set<number>();
  const visit = (i: number, path: Set<number>) => {
    if (placed.has(i) || path.has(i)) return;
    path.add(i);
    for (const ref of [sources[i]!.answerKeyFor, sources[i]!.parallelOf]) {
      if (ref && "row" in ref) visit(ref.row, path);
    }
    placed.add(i);
    order.push(i);
  };
  sources.forEach((_, i) => visit(i, new Set()));
  return order;
}
