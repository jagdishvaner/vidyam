"use client";

import { Link, usePathname } from "@vidyam/app-shell/i18n/navigation";
import { Badge } from "@vidyam/ui/components/badge";
import { cn } from "@vidyam/ui/lib/utils";
import {
  Activity,
  BookOpenText,
  Bot,
  Building2,
  LayoutList,
  ListTree,
  MessageSquareCode,
  ScrollText,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";
import { useTranslations } from "next-intl";

/** Admin sections in plan order; those without a page yet are listed so admins see what is coming. */
const SECTIONS = [
  { key: "staff", href: "/staff", icon: Users },
  { key: "roles", href: "/roles", icon: ShieldCheck },
  { key: "exams", href: "/exams", icon: ListTree },
  { key: "blueprints", href: "/patterns", icon: LayoutList },
  { key: "content", href: null, icon: BookOpenText },
  { key: "models", href: "/models", icon: Bot },
  { key: "prompts", href: "/prompts", icon: MessageSquareCode },
  { key: "usage", href: "/usage", icon: Wallet },
  { key: "center", href: "/center", icon: Building2 },
  { key: "audit", href: "/audit", icon: ScrollText },
  { key: "health", href: "/health", icon: Activity },
] as const;

export function AdminNav() {
  const t = useTranslations("admin.sections");
  const tc = useTranslations("common");
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
      {SECTIONS.map(({ key, href, icon: Icon }) =>
        href ? (
          <Link
            key={key}
            href={href}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors hover:bg-sidebar-accent",
              pathname.startsWith(href) && "bg-sidebar-accent font-medium text-sidebar-primary",
            )}
          >
            <Icon className="size-4" />
            {t(key)}
          </Link>
        ) : (
          <span
            key={key}
            className="flex shrink-0 items-center gap-2 px-3 py-2 text-sm whitespace-nowrap text-muted-foreground"
          >
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
