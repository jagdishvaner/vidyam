import { Skeleton } from "@vidyam/ui/components/skeleton";
import { useTranslations } from "next-intl";
import { Suspense, type ReactNode } from "react";

import { LanguageSwitcher } from "@/features/shell/language-switcher";
import { Nav } from "@/features/shell/nav";
import { ThemeToggle } from "@/features/shell/theme-toggle";
import { UserMenu } from "@/features/shell/user-menu";

/** The shell (navigation, header) is static and prerendered; only the user menu waits for the session. */
export default function AppLayout({ children }: { children: ReactNode }) {
  const t = useTranslations("common");
  return (
    <div className="flex min-h-svh">
      <aside className="hidden w-64 shrink-0 flex-col gap-6 border-r bg-sidebar px-3 py-5 md:flex">
        <div className="px-3">
          <p className="text-lg font-semibold tracking-tight">{t("appName")}</p>
          <p className="text-xs text-muted-foreground">{t("tagline")}</p>
        </div>
        {/* The links depend on the user's role and the URL: stream them in so the shell stays static. */}
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <Nav />
        </Suspense>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-2 border-b px-4 md:px-8">
          <span className="font-semibold md:hidden">{t("appName")}</span>
          <div className="ml-auto flex items-center gap-1">
            <Suspense fallback={<Skeleton className="h-8 w-20" />}>
              <LanguageSwitcher />
            </Suspense>
            <ThemeToggle />
            <Suspense fallback={<Skeleton className="h-9 w-32 rounded-md" />}>
              <UserMenu />
            </Suspense>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
