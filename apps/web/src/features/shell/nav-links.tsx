"use client";

import { Badge } from "@vidyam/ui/components/badge";
import { cn } from "@vidyam/ui/lib/utils";
import {
  BookOpenText,
  ClipboardCheck,
  ExternalLink,
  FileQuestion,
  LayoutDashboard,
  MessagesSquare,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { Link, usePathname } from "@vidyam/app-shell/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";

const ITEMS = [
  { key: "dashboard", href: "/", icon: LayoutDashboard },
  { key: "chat", href: "/chat", icon: MessagesSquare },
  { key: "library", href: "/library", icon: BookOpenText },
  { key: "questionBank", href: null, icon: FileQuestion },
  { key: "review", href: null, icon: ClipboardCheck },
  { key: "settings", href: "/settings", icon: Settings },
] as const;

/** `adminUrl`: the admin panel's origin (its own subdomain), for those who can manage the center. */
export function NavLinks({ adminUrl }: { adminUrl: string | null }) {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const locale = useLocale();
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {ITEMS.map(({ key, href, icon: Icon }) =>
        href ? (
          <Link
            key={key}
            href={href}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent",
              (href === "/" ? pathname === href : pathname.startsWith(href)) &&
                "bg-sidebar-accent font-medium text-sidebar-primary",
            )}
          >
            <Icon className="size-4" />
            {t(key)}
          </Link>
        ) : (
          <span key={key} className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
            <Icon className="size-4" />
            {t(key)}
            <Badge variant="secondary" className="ml-auto text-[10px]">
              {tc("comingSoon")}
            </Badge>
          </span>
        ),
      )}
      {adminUrl && (
        <a
          href={`${adminUrl}/${locale}`}
          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent"
        >
          <ShieldCheck className="size-4" />
          {t("admin")}
          <ExternalLink className="ml-auto size-3.5 text-muted-foreground" />
        </a>
      )}
    </nav>
  );
}
