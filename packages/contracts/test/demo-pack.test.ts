import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  BlueprintImport,
  ExamPaperImport,
  GlossaryTermImport,
  parseManifestCsv,
  QuestionImport,
  SyllabusImport,
  type SyllabusNodeImport,
} from "../src/index.js";

/** The demo content pack (fixtures/demo-pack) is the test fixture and first evaluation set; it must stay valid. */
const PACK = path.join(import.meta.dirname, "..", "..", "..", "fixtures", "demo-pack");
const read = (file: string) => readFileSync(path.join(PACK, file), "utf8");
const json = (file: string): unknown => JSON.parse(read(file));

function codePaths(node: SyllabusNodeImport, prefix = ""): Map<string, string> {
  const here = prefix ? `${prefix}/${node.code}` : node.code;
  const paths = new Map([[here, node.level as string]]);
  for (const child of node.children) for (const [p, level] of codePaths(child, here)) paths.set(p, level);
  return paths;
}

const syllabus = SyllabusImport.parse(json("catalog/syllabus-science.json"));
const nodes = codePaths(syllabus.subject);
const exams = ExamPaperImport.array().parse(json("catalog/exams.json"));

describe("demo pack", () => {
  it("has a syllabus with unique sibling codes, down to topics", () => {
    const levels = [...nodes.values()];
    expect(levels.filter((l) => l === "chapter")).toHaveLength(9);
    expect(levels.filter((l) => l === "topic")).toHaveLength(42);
  });

  it("has exam papers and paper patterns that point at real syllabus nodes", () => {
    for (const exam of exams)
      for (const part of exam.syllabus) expect(nodes.has(part.node), part.node).toBe(true);
    const blueprints = BlueprintImport.array().parse(json("catalog/blueprints.json"));
    expect(blueprints.map((b) => b.name)).toEqual(["Full paper", "Chapter test", "Practice worksheet"]);
    for (const b of blueprints) expect(exams.map((e) => e.code)).toContain(b.exam);
    const full = blueprints[0]!.blueprint;
    expect(full.sections.reduce((sum, s) => sum + s.count * s.marksEach, 0)).toBe(300);
  });

  it("has a glossary of unique term pairs", () => {
    const [header, ...lines] = read("catalog/glossary.csv").trim().split("\n");
    expect(header).toBe("en,hi,subject");
    const terms = lines.map((line) => {
      const [en, hi, subject] = line.split(",");
      return GlossaryTermImport.parse({ en, hi, subject });
    });
    expect(new Set(terms.map((t) => t.en)).size).toBe(terms.length);
    expect(terms.length).toBeGreaterThanOrEqual(80);
  });

  it("has a manifest whose every row is valid and points at a built file", () => {
    const { rows, problems } = parseManifestCsv(read("manifest.csv"));
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(10);
    const listed = new Set(rows.map((r) => r.file));
    for (const row of rows) {
      expect(existsSync(path.join(PACK, row.file)), row.file).toBe(true);
      for (const exam of row.exams) expect(exams.map((e) => e.code)).toContain(exam);
      const chapters = [row.chapter, ...(row.sections ?? []).map((s) => s.chapter)].filter(
        Boolean,
      ) as string[];
      for (const chapter of chapters) expect(nodes.get(chapter), chapter).toBe("chapter");
      if (row.answerKeyFor) expect(listed).toContain(row.answerKeyFor);
      if (row.parallelOf) expect(listed).toContain(row.parallelOf);
    }
    expect(readdirSync(path.join(PACK, "files")).sort()).toEqual(
      [...listed].map((f) => path.basename(f)).sort(),
    );
  });

  it("has 200 bilingual questions tagged to syllabus topics", () => {
    const files = readdirSync(path.join(PACK, "questions")).filter((f) => f.endsWith(".json"));
    const questions = files.flatMap((f) => QuestionImport.array().parse(json(`questions/${f}`)));
    expect(questions).toHaveLength(200);
    expect(new Set(questions.map((q) => q.ref)).size).toBe(200);
    for (const q of questions) {
      expect(q.content.hi && q.content.en, q.ref).toBeTruthy();
      for (const node of q.taxonomy) expect(nodes.has(node), `${q.ref} ${node}`).toBe(true);
    }
  });

  it("has 50 retrieval queries across Hindi, English and Hinglish", () => {
    const queries = json("eval/retrieval.json") as { id: string; lang: string; node: string }[];
    expect(queries).toHaveLength(50);
    expect(new Set(queries.map((q) => q.id)).size).toBe(50);
    for (const lang of ["hi", "en", "hinglish"]) {
      expect(queries.filter((q) => q.lang === lang).length, lang).toBeGreaterThanOrEqual(10);
    }
    for (const q of queries) expect(nodes.has(q.node), q.id).toBe(true);
  });
});
