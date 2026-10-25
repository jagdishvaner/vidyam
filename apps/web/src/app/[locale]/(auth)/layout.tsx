import { Skeleton } from "@vidyam/ui/components/skeleton";
import { useTranslations } from "next-intl";
import { Suspense, type ReactNode } from "react";

import { LanguageSwitcher } from "@/features/shell/language-switcher";

export default function AuthLayout({ children }: { children: ReactNode }) {
  const t = useTranslations("common");
  return (
    <main className="flex min-h-svh flex-col bg-muted/40">
      <header className="flex items-center justify-between px-6 py-4">
        <span className="text-lg font-semibold tracking-tight">{t("appName")}</span>
        {/* Reads the current URL, which dynamic routes only know at request time. */}
        <Suspense fallback={<Skeleton className="h-8 w-20" />}>
          <LanguageSwitcher />
        </Suspense>
      </header>
      <div className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-sm space-y-6">
          <p className="text-center text-sm text-muted-foreground">{t("tagline")}</p>
          {children}
        </div>
      </div>
    </main>
  );
}
