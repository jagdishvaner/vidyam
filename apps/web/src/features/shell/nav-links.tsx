"use client";

import { Badge } from "@vidyam/ui/components/badge";
import { cn } from "@vidyam/ui/lib/utils";
import {
  BookOpenText,
  ClipboardCheck,
  FileQuestion,
  LayoutDashboard,
  MessagesSquare,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";

const ITEMS = [
  { key: "dashboard", href: "/", icon: LayoutDashboard },
  { key: "chat", href: null, icon: MessagesSquare },
  { key: "library", href: "/library", icon: BookOpenText },
  { key: "questionBank", href: null, icon: FileQuestion },
  { key: "review", href: null, icon: ClipboardCheck },
  { key: "settings", href: null, icon: Settings },
] as const;

const ADMIN = { key: "admin", href: "/admin", icon: ShieldCheck } as const;

export function NavLinks({ isAdmin }: { isAdmin: boolean }) {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const pathname = usePathname();
  const items = isAdmin ? [...ITEMS, ADMIN] : ITEMS;
  return (
    <nav className="flex flex-col gap-1">
      {items.map(({ key, href, icon: Icon }) =>
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
    </nav>
  );
}
