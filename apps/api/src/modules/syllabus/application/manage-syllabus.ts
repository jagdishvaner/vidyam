import { Inject, Injectable } from "@nestjs/common";
import type {
  CreateSyllabusNodeRequest,
  ExamPaper,
  ExamPaperImport,
  ImportSummary,
  SyllabusImport,
  SyllabusNode,
  SyllabusOverview,
  SyllabusSubject,
  UpdateSyllabusNodeRequest,
} from "@vidyam/contracts";

import { DomainError } from "../../../shared/kernel/errors.js";
import { canNest, flattenTree, type FlatNode, type Level } from "../domain/syllabus-tree.js";

/** Port: the center's syllabus tree and exam papers. */
export interface SyllabusStore {
  overview(orgId: string): Promise<SyllabusOverview>;
  subject(orgId: string, subjectId: string): Promise<SyllabusSubject | null>;
  /** Upserts by code path, parents first, in one transaction. Nodes missing from the file are left alone. */
  importTree(orgId: string, nodes: FlatNode[]): Promise<ImportSummary>;
  findNode(orgId: string, id: string): Promise<{ id: string; level: Level; path: string } | null>;
  /** Fails with a conflict when the parent already has a child with this code. */
  createNode(orgId: string, request: CreateSyllabusNodeRequest): Promise<SyllabusNode>;
  updateNode(orgId: string, id: string, edit: UpdateSyllabusNodeRequest): Promise<SyllabusNode>;
  exams(orgId: string): Promise<ExamPaper[]>;
  /** Node ids for these code paths; paths that don't exist are missing from the map. */
  resolvePaths(orgId: string, paths: string[]): Promise<Map<string, string>>;
  /** Upserts each paper by code, replacing its syllabus links. */
  upsertExams(orgId: string, exams: ResolvedExam[]): Promise<ImportSummary>;
  deleteExam(orgId: string, id: string): Promise<boolean>;
}
export const SYLLABUS_STORE = Symbol("SYLLABUS_STORE");

export type ResolvedExam = Omit<ExamPaperImport, "syllabus"> & {
  syllabus: { nodeId: string; weightage: number | null }[];
};

@Injectable()
export class BrowseSyllabus {
  constructor(@Inject(SYLLABUS_STORE) private readonly store: SyllabusStore) {}

  overview(orgId: string): Promise<SyllabusOverview> {
    return this.store.overview(orgId);
  }

  async subject(orgId: string, subjectId: string): Promise<SyllabusSubject> {
    const subject = await this.store.subject(orgId, subjectId);
    if (!subject) throw new DomainError("No such subject in this center's syllabus.", "not_found");
    return subject;
  }

  exams(orgId: string): Promise<ExamPaper[]> {
    return this.store.exams(orgId);
  }
}

/** Loads a whole subject tree from the import format; running it again only updates what changed. */
@Injectable()
export class ImportSyllabus {
  constructor(@Inject(SYLLABUS_STORE) private readonly store: SyllabusStore) {}

  async execute(orgId: string, file: SyllabusImport): Promise<ImportSummary> {
    const { nodes, problems } = flattenTree(file.subject);
    if (problems.length) throw new DomainError(problems.slice(0, 10).join("; "), "invalid");
    return this.store.importTree(orgId, nodes);
  }
}

@Injectable()
export class EditSyllabus {
  constructor(@Inject(SYLLABUS_STORE) private readonly store: SyllabusStore) {}

  async create(orgId: string, request: CreateSyllabusNodeRequest): Promise<SyllabusNode> {
    const parent = request.parentId ? await this.store.findNode(orgId, request.parentId) : null;
    if (request.parentId && !parent) throw new DomainError("The parent node doesn't exist.", "not_found");
    if (!canNest(parent?.level ?? null, request.level)) {
      throw new DomainError(
        parent
          ? `A ${request.level} can't sit under a ${parent.level}.`
          : "Only a subject can be at the top.",
        "invalid",
      );
    }
    return this.store.createNode(orgId, request);
  }

  async update(orgId: string, id: string, edit: UpdateSyllabusNodeRequest): Promise<SyllabusNode> {
    if (!(await this.store.findNode(orgId, id))) throw new DomainError("No such syllabus node.", "not_found");
    return this.store.updateNode(orgId, id, edit);
  }
}

/** Exam papers name their syllabus by code path, so the same file loads into any environment. */
@Injectable()
export class ImportExamPapers {
  constructor(@Inject(SYLLABUS_STORE) private readonly store: SyllabusStore) {}

  async execute(orgId: string, exams: ExamPaperImport[]): Promise<ImportSummary> {
    const codes = exams.map((e) => e.code);
    const repeated = codes.filter((code, i) => codes.indexOf(code) !== i);
    if (repeated.length)
      throw new DomainError(`Listed twice: ${[...new Set(repeated)].join(", ")}`, "invalid");
    const ids = await this.store.resolvePaths(orgId, [
      ...new Set(exams.flatMap((e) => e.syllabus.map((s) => s.node))),
    ]);
    const missing = exams.flatMap((e) =>
      e.syllabus.filter((s) => !ids.has(s.node)).map((s) => `${e.code}: ${s.node}`),
    );
    if (missing.length) {
      throw new DomainError(`Not in the syllabus yet: ${missing.slice(0, 10).join("; ")}`, "invalid");
    }
    return this.store.upsertExams(
      orgId,
      exams.map((exam) => ({
        ...exam,
        syllabus: exam.syllabus.map((s) => ({ nodeId: ids.get(s.node)!, weightage: s.weightage ?? null })),
      })),
    );
  }
}

@Injectable()
export class DeleteExamPaper {
  constructor(@Inject(SYLLABUS_STORE) private readonly store: SyllabusStore) {}

  async execute(orgId: string, id: string): Promise<void> {
    if (!(await this.store.deleteExam(orgId, id))) throw new DomainError("No such exam paper.", "not_found");
  }
}
