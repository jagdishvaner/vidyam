import type { Metadata } from "next";
import { useTranslations } from "next-intl";

import { BacklogsAdmin } from "@/features/content/backlogs-admin";

export const metadata: Metadata = { title: "Content" };

export default function ContentPage() {
  const t = useTranslations("content");
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>
      <BacklogsAdmin />
    </div>
  );
}
