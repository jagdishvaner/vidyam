"use client";

import { Badge } from "@vidyam/ui/components/badge";
import { cn } from "@vidyam/ui/lib/utils";
import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";

/** Admin sections in plan order; those without a page yet are listed so admins see what is coming. */
const SECTIONS = [
  { key: "staff", href: "/admin/staff" },
  { key: "roles", href: "/admin/roles" },
  { key: "exams", href: "/admin/exams" },
  { key: "blueprints", href: "/admin/patterns" },
  { key: "content", href: null },
  { key: "models", href: null },
  { key: "prompts", href: null },
  { key: "usage", href: null },
  { key: "center", href: null },
  { key: "audit", href: null },
  { key: "health", href: null },
] as const;

export function AdminNav() {
  const t = useTranslations("admin.sections");
  const tc = useTranslations("common");
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
      {SECTIONS.map(({ key, href }) =>
        href ? (
          <Link
            key={key}
            href={href}
            className={cn(
              "shrink-0 rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors hover:bg-accent",
              pathname.startsWith(href) && "bg-accent font-medium",
            )}
          >
            {t(key)}
          </Link>
        ) : (
          <span
            key={key}
            className="flex shrink-0 items-center gap-2 px-3 py-2 text-sm whitespace-nowrap text-muted-foreground"
          >
            {t(key)}
            <Badge variant="secondary" className="ml-auto text-[10px]">
              {tc("comingSoon")}
            </Badge>
          </span>
        ),
      )}
    </nav>
  );
}
