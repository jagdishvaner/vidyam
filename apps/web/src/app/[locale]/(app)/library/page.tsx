import type { Metadata } from "next";
import { useTranslations } from "next-intl";

import { LibraryView } from "@/features/library/library-view";

export const metadata: Metadata = { title: "Library" };

export default function LibraryPage() {
  const t = useTranslations("library");
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>
      <LibraryView />
    </div>
  );
}
