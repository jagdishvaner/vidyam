"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@vidyam/ui/components/tabs";
import { useTranslations } from "next-intl";

import { ExamPapersPanel } from "./exam-papers-panel";
import { SyllabusPanel } from "./syllabus-panel";

export function SyllabusAdmin() {
  const t = useTranslations("syllabus");
  return (
    <Tabs defaultValue="syllabus" className="gap-4">
      <TabsList>
        <TabsTrigger value="syllabus">{t("syllabusTab")}</TabsTrigger>
        <TabsTrigger value="exams">{t("examsTab")}</TabsTrigger>
      </TabsList>
      <TabsContent value="syllabus">
        <SyllabusPanel />
      </TabsContent>
      <TabsContent value="exams">
        <ExamPapersPanel />
      </TabsContent>
    </Tabs>
  );
}
