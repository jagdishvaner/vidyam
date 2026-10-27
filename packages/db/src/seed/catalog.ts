/**
 * Starting exam catalog for a coaching center: the exams and their subject-level syllabus nodes.
 * Chapters, topics and paper blueprints are added from the official syllabi with the teachers (plan Step 60);
 * nothing below the subject level is guessed here.
 */
import { and, eq, isNull } from "drizzle-orm";

import { schema, type Database } from "../index.js";

interface SubjectSeed {
  key: string;
  en: string;
  hi: string;
}

const SUBJECTS: SubjectSeed[] = [
  { key: "physics", en: "Physics", hi: "भौतिक विज्ञान" },
  { key: "chemistry", en: "Chemistry", hi: "रसायन विज्ञान" },
  { key: "mathematics", en: "Mathematics", hi: "गणित" },
  { key: "biology", en: "Biology", hi: "जीव विज्ञान" },
  { key: "science", en: "Science", hi: "विज्ञान" },
  { key: "social_science", en: "Social Science", hi: "सामाजिक विज्ञान" },
  { key: "hindi", en: "Hindi", hi: "हिन्दी" },
  { key: "english", en: "English", hi: "अंग्रेज़ी" },
  { key: "rajasthan_gk", en: "General Knowledge of Rajasthan", hi: "राजस्थान का सामान्य ज्ञान" },
  { key: "general_studies", en: "General Studies", hi: "सामान्य अध्ययन" },
  { key: "educational_psychology", en: "Educational Psychology", hi: "शैक्षिक मनोविज्ञान" },
  { key: "child_development", en: "Child Development and Pedagogy", hi: "बाल विकास एवं शिक्षण विधियाँ" },
];

interface ExamSeed {
  code: string;
  en: string;
  hi: string;
  authoritativeLanguage: "hi" | "en";
  subjects: string[];
}

const EXAMS: ExamSeed[] = [
  {
    code: "jee_main",
    en: "JEE Main",
    hi: "जेईई मेन",
    authoritativeLanguage: "en",
    subjects: ["physics", "chemistry", "mathematics"],
  },
  {
    code: "neet_ug",
    en: "NEET (UG)",
    hi: "नीट (यूजी)",
    authoritativeLanguage: "en",
    subjects: ["physics", "chemistry", "biology"],
  },
  {
    code: "rpsc_2nd_grade",
    en: "RPSC Senior Teacher (2nd Grade)",
    hi: "आरपीएससी वरिष्ठ अध्यापक (द्वितीय श्रेणी)",
    authoritativeLanguage: "hi",
    subjects: [
      "rajasthan_gk",
      "educational_psychology",
      "science",
      "mathematics",
      "social_science",
      "hindi",
      "english",
    ],
  },
  {
    code: "rpsc_1st_grade",
    en: "RPSC School Lecturer (1st Grade)",
    hi: "आरपीएससी प्राध्यापक (प्रथम श्रेणी)",
    authoritativeLanguage: "hi",
    subjects: [
      "general_studies",
      "educational_psychology",
      "physics",
      "chemistry",
      "biology",
      "mathematics",
      "hindi",
      "english",
    ],
  },
  {
    code: "reet_level_2",
    en: "REET Level 2",
    hi: "रीट लेवल 2",
    authoritativeLanguage: "hi",
    subjects: ["child_development", "hindi", "english", "mathematics", "science", "social_science"],
  },
];

/** Idempotent. Run as the schema owner (row-level security does not apply). */
export async function seedExamCatalog(db: Database, orgId: string): Promise<void> {
  const subjectIds = new Map<string, string>();
  for (const [i, subject] of SUBJECTS.entries()) {
    const [existing] = await db
      .select({ id: schema.taxonomyNodes.id })
      .from(schema.taxonomyNodes)
      .where(
        and(
          eq(schema.taxonomyNodes.orgId, orgId),
          eq(schema.taxonomyNodes.level, "subject"),
          eq(schema.taxonomyNodes.nameEn, subject.en),
          isNull(schema.taxonomyNodes.parentId),
        ),
      )
      .limit(1);
    const id =
      existing?.id ??
      (
        await db
          .insert(schema.taxonomyNodes)
          .values({
            orgId,
            level: "subject",
            code: subject.key,
            nameEn: subject.en,
            nameHi: subject.hi,
            sortOrder: i,
          })
          .returning({ id: schema.taxonomyNodes.id })
      )[0]!.id;
    subjectIds.set(subject.key, id);
  }

  for (const exam of EXAMS) {
    const [row] = await db
      .insert(schema.exams)
      .values({
        orgId,
        code: exam.code,
        nameEn: exam.en,
        nameHi: exam.hi,
        authoritativeLanguage: exam.authoritativeLanguage,
      })
      .onConflictDoUpdate({
        target: [schema.exams.orgId, schema.exams.code],
        set: { nameEn: exam.en, nameHi: exam.hi },
      })
      .returning({ id: schema.exams.id });
    await db
      .insert(schema.examSyllabus)
      .values(exam.subjects.map((key) => ({ orgId, examId: row!.id, nodeId: subjectIds.get(key)! })))
      .onConflictDoNothing();
  }
}
