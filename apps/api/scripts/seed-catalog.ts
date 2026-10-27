/**
 * The official exam papers and syllabus trees seeded into every center (apps/api/seed/). Each subject has one
 * canonical tree (`syllabi/<subject>.json`); each exam paper covers parts of those trees, listed per subject in
 * `coverage/<subject>.json`. Paper patterns for the papers are in `blueprints.json`. This module loads and
 * checks them all; `pnpm seed:check` prints the problems.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { BlueprintImport, ExamPaperImport, Language, NodeCode, SyllabusImport } from "@vidyam/contracts";
import { z } from "zod";

import { flattenTree, type FlatNode } from "../src/modules/syllabus/domain/syllabus-tree.js";

export const SEED_DIR = path.join(import.meta.dirname, "..", "seed");

const Catalog = z.object({
  subjects: z.array(z.object({ code: NodeCode, nameEn: z.string(), nameHi: z.string() })),
  papers: z.array(
    ExamPaperImport.omit({ syllabus: true }).extend({
      authoritativeLanguage: Language,
      subjects: z.array(NodeCode),
    }),
  ),
});
const Coverage = z.record(
  z.string(),
  z.array(z.object({ node: z.string(), weightage: z.number().min(0).max(1).optional() })),
);

export interface SeedCatalog {
  syllabi: { subject: string; file: SyllabusImport; nodes: FlatNode[] }[];
  exams: ExamPaperImport[];
  blueprints: BlueprintImport[];
  problems: string[];
  warnings: string[];
}

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));

export function loadSeedCatalog(only?: string): SeedCatalog {
  const problems: string[] = [];
  const warnings: string[] = [];
  const catalog = Catalog.parse(readJson(path.join(SEED_DIR, "catalog.json")));
  const subjects = new Set(catalog.subjects.map((s) => s.code));
  const wanted = (subject: string) => only === undefined || subject === only;

  const syllabi: SeedCatalog["syllabi"] = [];
  const pathsOf = new Map<string, Set<string>>();
  for (const subject of catalog.subjects) {
    const file = path.join(SEED_DIR, "syllabi", `${subject.code}.json`);
    if (!existsSync(file)) {
      if (wanted(subject.code)) problems.push(`${subject.code}: syllabi/${subject.code}.json is missing`);
      continue;
    }
    const parsed = SyllabusImport.safeParse(readJson(file));
    if (!parsed.success) {
      problems.push(
        `${subject.code}: ${parsed.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join(".")} ${i.message}`)
          .join("; ")}`,
      );
      continue;
    }
    const { nodes, problems: treeProblems } = flattenTree(parsed.data.subject);
    if (parsed.data.subject.code !== subject.code)
      problems.push(`${subject.code}: the root's code must be "${subject.code}"`);
    problems.push(...treeProblems.map((p) => `${subject.code}: ${p}`));
    for (const node of nodes) {
      if (!node.nameHi) problems.push(`${node.path}: needs a Hindi name`);
      const children = nodes.filter((n) => n.parentPath === node.path).length;
      if (node.level === "chapter" && children < 2)
        warnings.push(`${node.path}: a chapter with ${children} topic(s)`);
    }
    syllabi.push({ subject: subject.code, file: parsed.data, nodes });
    pathsOf.set(subject.code, new Set(nodes.map((n) => n.path)));
  }

  const links = new Map<string, { node: string; weightage?: number }[]>();
  const covered = new Map<string, Set<string>>(); // exam code → subjects that list coverage for it
  const coverageDir = path.join(SEED_DIR, "coverage");
  for (const name of existsSync(coverageDir) ? readdirSync(coverageDir) : []) {
    const subject = path.basename(name, ".json");
    if (!subjects.has(subject)) {
      problems.push(`coverage/${name}: not a catalog subject`);
      continue;
    }
    const coverage = Coverage.parse(readJson(path.join(coverageDir, name)));
    for (const [exam, nodes] of Object.entries(coverage)) {
      const paper = catalog.papers.find((p) => p.code === exam);
      if (!paper) problems.push(`coverage/${name}: unknown exam paper "${exam}"`);
      else if (!paper.subjects.includes(subject))
        problems.push(`coverage/${name}: ${exam} doesn't include ${subject}`);
      for (const link of nodes) {
        if (!link.node.startsWith(`${subject}/`) && link.node !== subject) {
          problems.push(`coverage/${name}: ${exam} links ${link.node}, which is outside ${subject}`);
        } else if (pathsOf.has(subject) && !pathsOf.get(subject)!.has(link.node)) {
          problems.push(`coverage/${name}: ${exam} links ${link.node}, which isn't in the ${subject} tree`);
        }
      }
      links.set(exam, [...(links.get(exam) ?? []), ...nodes]);
      covered.set(exam, new Set([...(covered.get(exam) ?? []), subject]));
    }
  }

  const exams: ExamPaperImport[] = [];
  for (const { subjects: paperSubjects, ...paper } of catalog.papers) {
    for (const subject of paperSubjects) {
      if (wanted(subject) && !covered.get(paper.code)?.has(subject)) {
        problems.push(`${paper.code}: coverage/${subject}.json doesn't list it`);
      }
    }
    const syllabus = links.get(paper.code) ?? [];
    if (syllabus.length) exams.push({ ...paper, syllabus });
  }

  const blueprints: BlueprintImport[] = [];
  const blueprintFile = path.join(SEED_DIR, "blueprints.json");
  if (existsSync(blueprintFile)) {
    const parsed = z.array(BlueprintImport).safeParse(readJson(blueprintFile));
    if (!parsed.success) {
      problems.push(
        `blueprints.json: ${parsed.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join(".")} ${i.message}`)
          .join("; ")}`,
      );
    } else {
      for (const blueprint of parsed.data) {
        const paper = catalog.papers.find((p) => p.code === blueprint.exam);
        const label = `blueprints.json: ${blueprint.exam} "${blueprint.name}"`;
        if (!paper) {
          problems.push(`${label}: unknown exam paper`);
          continue;
        }
        if (parsed.data.filter((b) => b.exam === blueprint.exam && b.name === blueprint.name).length > 1) {
          problems.push(`${label}: listed twice`);
        }
        for (const scope of blueprint.blueprint.sections.flatMap((section) => section.scope)) {
          const subject = scope.split("/")[0]!;
          if (!paper.subjects.includes(subject))
            problems.push(`${label}: section scope ${scope} is outside the paper`);
          else if (pathsOf.has(subject) && !pathsOf.get(subject)!.has(scope)) {
            problems.push(`${label}: section scope ${scope} isn't in the ${subject} tree`);
          }
        }
        blueprints.push(blueprint);
      }
    }
  }

  const scoped = (message: string) => only === undefined || message.includes(only);
  return { syllabi, exams, blueprints, problems: problems.filter(scoped), warnings: warnings.filter(scoped) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : undefined;
  const { syllabi, exams, blueprints, problems, warnings } = loadSeedCatalog(only);
  for (const { subject, nodes } of syllabi) {
    if (only && subject !== only) continue;
    const levels = Object.entries(
      nodes.reduce<Record<string, number>>(
        (count, n) => ({ ...count, [n.level]: (count[n.level] ?? 0) + 1 }),
        {},
      ),
    );
    console.log(`${subject}: ${levels.map(([level, n]) => `${n} ${level}`).join(", ")}`);
  }
  console.log(`${exams.length} exam papers with coverage, ${blueprints.length} paper patterns`);
  for (const warning of warnings) console.log(`warning: ${warning}`);
  for (const problem of problems) console.error(`problem: ${problem}`);
  console.log(problems.length ? `${problems.length} problem(s)` : "ok");
  process.exit(problems.length ? 1 : 0);
}
