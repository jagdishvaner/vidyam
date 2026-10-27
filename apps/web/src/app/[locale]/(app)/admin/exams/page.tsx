import type { Metadata } from "next";
import { useTranslations } from "next-intl";

import { SyllabusAdmin } from "@/features/syllabus/syllabus-admin";

export const metadata: Metadata = { title: "Exams & syllabus" };

export default function ExamsPage() {
  const t = useTranslations("syllabus");
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <SyllabusAdmin />
    </div>
  );
}
