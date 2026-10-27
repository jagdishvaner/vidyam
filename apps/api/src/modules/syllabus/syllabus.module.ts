import { Module } from "@nestjs/common";

import {
  BrowseSyllabus,
  DeleteExamPaper,
  EditSyllabus,
  ImportExamPapers,
  ImportSyllabus,
  SYLLABUS_STORE,
} from "./application/manage-syllabus.js";
import { DrizzleSyllabusStore } from "./infrastructure/drizzle-syllabus-store.js";
import { SyllabusController } from "./interface/syllabus.controller.js";

/** Composition root for exams and the syllabus tree (Admin → Exams & syllabus). */
@Module({
  controllers: [SyllabusController],
  providers: [
    BrowseSyllabus,
    ImportSyllabus,
    EditSyllabus,
    ImportExamPapers,
    DeleteExamPaper,
    { provide: SYLLABUS_STORE, useClass: DrizzleSyllabusStore },
  ],
})
export class SyllabusModule {}
