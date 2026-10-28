import { APP_URL } from "@vidyam/app-shell/server/env";
import { getCurrentUser } from "@vidyam/app-shell/server/session";
import { LanguageSwitcher } from "@vidyam/app-shell/shell/language-switcher";
import { ThemeToggle } from "@vidyam/app-shell/shell/theme-toggle";
import { UserMenu } from "@vidyam/app-shell/shell/user-menu";
import { roleCan } from "@vidyam/contracts";
import { Alert, AlertDescription } from "@vidyam/ui/components/alert";
import { Button } from "@vidyam/ui/components/button";
import { Skeleton } from "@vidyam/ui/components/skeleton";
import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { Suspense, type ReactNode } from "react";

import { AdminNav } from "@/features/admin/admin-nav";

/** UI gate only: every admin endpoint is enforced by the API as well. */
async function AdminGate({ children }: { children: ReactNode }) {
  const [user, t, locale] = await Promise.all([getCurrentUser(), getTranslations("admin"), getLocale()]);
  if (!roleCan(user.orgRole, "settings", "manage")) {
    return (
      <Alert>
        <AlertDescription className="space-y-3">
          <p>{t("adminOnly")}</p>
          <Button asChild variant="outline" size="sm">
            <a href={`${APP_URL}/${locale}`}>{t("openApp")}</a>
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  return children;
}

/** Link back to the teachers' app (its own origin), in the current language. */
async function OpenApp() {
  const [t, locale] = await Promise.all([getTranslations("admin"), getLocale()]);
  return (
    <Button asChild variant="ghost" size="sm">
      <a href={`${APP_URL}/${locale}`}>
        <ExternalLink data-icon="inline-start" />
        {t("openApp")}
      </a>
    </Button>
  );
}

/** The admin panel's own shell: its sections in the sidebar, the same header pieces as the teachers' app. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const t = useTranslations();
  return (
    <div className="flex min-h-svh">
      <aside className="hidden w-64 shrink-0 flex-col gap-6 border-r bg-sidebar px-3 py-5 md:flex">
        <div className="px-3">
          <p className="text-lg font-semibold tracking-tight">{t("common.adminName")}</p>
          <p className="text-xs text-muted-foreground">{t("admin.subtitle")}</p>
        </div>
        {/* Highlighting reads the URL: stream it in so the shell stays static. */}
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <AdminNav />
        </Suspense>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-2 border-b px-4 md:px-8">
          <span className="font-semibold md:hidden">{t("common.adminName")}</span>
          <div className="ml-auto flex items-center gap-1">
            <Suspense>
              <OpenApp />
            </Suspense>
            <Suspense fallback={<Skeleton className="h-8 w-20" />}>
              <LanguageSwitcher />
            </Suspense>
            <ThemeToggle />
            <Suspense fallback={<Skeleton className="h-9 w-32 rounded-md" />}>
              <UserMenu />
            </Suspense>
          </div>
        </header>
        {/* Below md the sidebar hides; the sections scroll sideways above the page instead. */}
        <div className="border-b px-4 py-2 md:hidden">
          <Suspense fallback={<Skeleton className="h-9 w-full" />}>
            <AdminNav />
          </Suspense>
        </div>
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">
          <div className="mx-auto max-w-7xl">
            <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
              <AdminGate>{children}</AdminGate>
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}
