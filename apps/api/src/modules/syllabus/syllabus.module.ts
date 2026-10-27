import { Module } from "@nestjs/common";

import {
  BrowseSyllabus,
  DeleteExamPaper,
  EditSyllabus,
  ImportExamPapers,
  ImportSyllabus,
  SYLLABUS_STORE,
} from "./application/manage-syllabus.js";
import {
  ImportPaperPatterns,
  ListPaperPatterns,
  PATTERN_STORE,
  RetirePaperPattern,
  SavePaperPattern,
} from "./application/manage-patterns.js";
import { DrizzlePatternStore } from "./infrastructure/drizzle-pattern-store.js";
import { DrizzleSyllabusStore } from "./infrastructure/drizzle-syllabus-store.js";
import { PatternsController } from "./interface/patterns.controller.js";
import { SyllabusController } from "./interface/syllabus.controller.js";

/** Composition root for exams, the syllabus tree and paper patterns (Admin → Exams & syllabus, Paper patterns). */
@Module({
  controllers: [SyllabusController, PatternsController],
  providers: [
    BrowseSyllabus,
    ImportSyllabus,
    EditSyllabus,
    ImportExamPapers,
    DeleteExamPaper,
    { provide: SYLLABUS_STORE, useClass: DrizzleSyllabusStore },
    ListPaperPatterns,
    SavePaperPattern,
    ImportPaperPatterns,
    RetirePaperPattern,
    { provide: PATTERN_STORE, useClass: DrizzlePatternStore },
  ],
})
export class SyllabusModule {}
