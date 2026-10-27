import { Inject, Injectable } from "@nestjs/common";
import type {
  Blueprint,
  BlueprintImport,
  ImportSummary,
  PaperPattern,
  SavePaperPatternRequest,
} from "@vidyam/contracts";

import { DomainError } from "../../../shared/kernel/errors.js";
import { scopeProblems } from "../domain/paper-pattern.js";

export type SaveOutcome = "created" | "updated" | "unchanged";

/** Port: exam paper patterns (exam_blueprints), versioned. */
export interface PatternStore {
  /** The latest active version of each pattern, for one exam paper or all of them. */
  list(orgId: string, examId?: string): Promise<PaperPattern[]>;
  find(orgId: string, id: string): Promise<PaperPattern | null>;
  /** The paper's syllabus (code paths it links) and every code path in the center's tree. */
  examContext(orgId: string, examId: string): Promise<{ syllabus: string[]; knownPaths: Set<string> } | null>;
  examIdsByCode(orgId: string, codes: string[]): Promise<Map<string, string>>;
  /** Saves a new version unless the active one is identical; the previous version is retired, not deleted. */
  save(
    orgId: string,
    examId: string,
    name: string,
    blueprint: Blueprint,
  ): Promise<{ pattern: PaperPattern; outcome: SaveOutcome }>;
  retire(orgId: string, id: string): Promise<boolean>;
}
export const PATTERN_STORE = Symbol("PATTERN_STORE");

async function checkScopes(
  store: PatternStore,
  orgId: string,
  examId: string,
  blueprint: Blueprint,
  label = "",
) {
  const context = await store.examContext(orgId, examId);
  if (!context) throw new DomainError("No such exam paper.", "not_found");
  const problems = scopeProblems(blueprint, context.syllabus, context.knownPaths);
  if (problems.length) throw new DomainError(`${label}${problems.slice(0, 10).join("; ")}`, "invalid");
}

@Injectable()
export class ListPaperPatterns {
  constructor(@Inject(PATTERN_STORE) private readonly store: PatternStore) {}

  execute(orgId: string, examId?: string): Promise<PaperPattern[]> {
    return this.store.list(orgId, examId);
  }
}

@Injectable()
export class SavePaperPattern {
  constructor(@Inject(PATTERN_STORE) private readonly store: PatternStore) {}

  async create(orgId: string, request: SavePaperPatternRequest): Promise<PaperPattern> {
    await checkScopes(this.store, orgId, request.examId, request.blueprint);
    if ((await this.store.list(orgId, request.examId)).some((p) => p.name === request.name)) {
      throw new DomainError(`This exam paper already has a pattern called "${request.name}".`, "conflict");
    }
    return (await this.store.save(orgId, request.examId, request.name, request.blueprint)).pattern;
  }

  /** A new version of an existing pattern; renaming retires the old name. */
  async update(orgId: string, id: string, request: SavePaperPatternRequest): Promise<PaperPattern> {
    const current = await this.store.find(orgId, id);
    if (!current) throw new DomainError("No such paper pattern.", "not_found");
    if (current.examId !== request.examId)
      throw new DomainError("A pattern can't move to another exam paper.", "invalid");
    await checkScopes(this.store, orgId, request.examId, request.blueprint);
    const { pattern } = await this.store.save(orgId, request.examId, request.name, request.blueprint);
    if (request.name !== current.name) await this.store.retire(orgId, current.id);
    return pattern;
  }
}

/** Loads patterns from the import format (exam paper by code); re-importing only versions what changed. */
@Injectable()
export class ImportPaperPatterns {
  constructor(@Inject(PATTERN_STORE) private readonly store: PatternStore) {}

  async execute(orgId: string, blueprints: BlueprintImport[]): Promise<ImportSummary> {
    const ids = await this.store.examIdsByCode(orgId, [...new Set(blueprints.map((b) => b.exam))]);
    const unknown = [...new Set(blueprints.map((b) => b.exam).filter((code) => !ids.has(code)))];
    if (unknown.length) throw new DomainError(`Unknown exam papers: ${unknown.join(", ")}`, "invalid");
    for (const b of blueprints)
      await checkScopes(this.store, orgId, ids.get(b.exam)!, b.blueprint, `${b.exam} "${b.name}": `);
    const summary = { created: 0, updated: 0, unchanged: 0 };
    for (const b of blueprints) {
      const { outcome } = await this.store.save(orgId, ids.get(b.exam)!, b.name, b.blueprint);
      summary[outcome]++;
    }
    return summary;
  }
}

@Injectable()
export class RetirePaperPattern {
  constructor(@Inject(PATTERN_STORE) private readonly store: PatternStore) {}

  async execute(orgId: string, id: string): Promise<void> {
    if (!(await this.store.retire(orgId, id))) throw new DomainError("No such paper pattern.", "not_found");
  }
}
