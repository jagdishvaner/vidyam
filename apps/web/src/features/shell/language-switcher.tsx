"use client";

import { Button } from "@vidyam/ui/components/button";
import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";

import { usePathname, useRouter } from "@/i18n/navigation";

/** Switches between English and Hindi, keeping the current page. */
export function LanguageSwitcher() {
  const t = useTranslations("common");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const next = locale === "hi" ? "en" : "hi";

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      aria-label={t("language")}
      onClick={() => startTransition(() => router.replace(pathname, { locale: next }))}
    >
      <Languages data-icon="inline-start" />
      {next === "hi" ? "हिन्दी" : "English"}
    </Button>
  );
}
