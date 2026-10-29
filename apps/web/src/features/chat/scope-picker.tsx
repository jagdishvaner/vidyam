"use client";

import type { ChatScopeNode } from "@vidyam/contracts";
import { Badge } from "@vidyam/ui/components/badge";
import { Checkbox } from "@vidyam/ui/components/checkbox";
import { Input } from "@vidyam/ui/components/input";
import { Skeleton } from "@vidyam/ui/components/skeleton";
import { ChevronRight, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { useScope } from "./api";
import { localName } from "./labels";

const SEARCH_LIMIT = 60;
const OPEN_ALL = 300;

/**
 * Chapters and topics to cover, from the exam's syllabus (or every subject's chapters), each with how much
 * material and how many bank questions it has. A chapter also covers its topics.
 */
export function ScopePicker({
  examCode,
  value,
  onChange,
  options,
}: {
  examCode: string | null;
  value: string[];
  onChange: (ids: string[]) => void;
  /** What a typed name could mean: offered, not chosen. */
  options: string[];
}) {
  const t = useTranslations("chat.scope");
  const locale = useLocale();
  const scope = useScope(examCode, [...new Set([...value, ...options])]);
  const [search, setSearch] = useState("");
  const nodes = useMemo(() => scope.data?.nodes ?? [], [scope.data]);
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const children = useMemo(() => {
    const map = new Map<string | null, ChatScopeNode[]>();
    for (const node of nodes) {
      const parent = node.parentId && byId.has(node.parentId) ? node.parentId : null;
      map.set(parent, [...(map.get(parent) ?? []), node]);
    }
    return map;
  }, [nodes, byId]);
  const selected = new Set(value);
  const toggle = (id: string) => onChange(selected.has(id) ? value.filter((v) => v !== id) : [...value, id]);
  const term = search.trim().toLowerCase();
  const matches = term
    ? nodes
        .filter((node) => `${node.nameEn} ${node.nameHi ?? ""} ${node.code}`.toLowerCase().includes(term))
        .slice(0, SEARCH_LIMIT)
    : [];
  const offered = options.filter((id) => byId.has(id) && !selected.has(id));
  // A big syllabus opens at subjects only, so a thousand rows don't render at once.
  const openLevels = nodes.length > OPEN_ALL ? ["subject"] : ["subject", "unit"];

  if (scope.isPending) return <Skeleton className="h-48 w-full" />;
  return (
    <div className="space-y-3">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => (
            <Badge key={id} variant="secondary" className="gap-1">
              {byId.get(id) ? localName(locale, byId.get(id)!) : id}
              <button type="button" aria-label={t("remove")} onClick={() => toggle(id)}>
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      {offered.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t("didYouMean")}</p>
          <div className="flex flex-wrap gap-1.5">
            {offered.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => toggle(id)}
                className="rounded-md border px-2 py-0.5 text-xs hover:bg-muted"
              >
                + {localName(locale, byId.get(id)!)}
                <span className="text-muted-foreground"> · {path(byId, id, locale)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <Input placeholder={t("search")} value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="relative max-h-72 overflow-y-auto rounded-md border p-2 text-sm">
        {term ? (
          matches.length ? (
            matches.map((node) => (
              <NodeRow
                key={node.id}
                node={node}
                checked={selected.has(node.id)}
                onToggle={toggle}
                hint={path(byId, node.id, locale)}
              />
            ))
          ) : (
            <p className="p-2 text-muted-foreground">{t("noMatch")}</p>
          )
        ) : (
          (children.get(null) ?? []).map((node) => (
            <Branch
              key={node.id}
              node={node}
              childrenOf={children}
              selected={selected}
              onToggle={toggle}
              openLevels={openLevels}
            />
          ))
        )}
      </div>
    </div>
  );
}

function path(byId: Map<string, ChatScopeNode>, id: string, locale: string): string {
  const names: string[] = [];
  let node = byId.get(byId.get(id)?.parentId ?? "");
  while (node && names.length < 3) {
    names.unshift(localName(locale, node));
    node = byId.get(node.parentId ?? "");
  }
  return names.join(" › ");
}

function Branch({
  node,
  childrenOf,
  selected,
  onToggle,
  openLevels,
}: {
  node: ChatScopeNode;
  childrenOf: Map<string | null, ChatScopeNode[]>;
  selected: Set<string>;
  onToggle: (id: string) => void;
  openLevels: string[];
}) {
  const kids = childrenOf.get(node.id) ?? [];
  const [open, setOpen] = useState(openLevels.includes(node.level));
  return (
    <div>
      <div className="flex items-center">
        {kids.length > 0 ? (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="p-1 text-muted-foreground"
            aria-expanded={open}
          >
            <ChevronRight className={`size-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
          </button>
        ) : (
          <span className="w-5.5" />
        )}
        <NodeRow node={node} checked={selected.has(node.id)} onToggle={onToggle} />
      </div>
      {open && kids.length > 0 && (
        <div className="ml-4 border-l pl-1">
          {kids.map((kid) => (
            <Branch
              key={kid.id}
              node={kid}
              childrenOf={childrenOf}
              selected={selected}
              onToggle={onToggle}
              openLevels={openLevels}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NodeRow({
  node,
  checked,
  onToggle,
  hint,
}: {
  node: ChatScopeNode;
  checked: boolean;
  onToggle: (id: string) => void;
  hint?: string;
}) {
  const t = useTranslations("chat.scope");
  const locale = useLocale();
  return (
    <label className="flex flex-1 cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-muted/60">
      <Checkbox checked={checked} onCheckedChange={() => onToggle(node.id)} />
      <span className="min-w-0 flex-1">
        <span className={node.level === "topic" || node.level === "subtopic" ? "" : "font-medium"}>
          {localName(locale, node)}
        </span>
        {hint && <span className="block truncate text-xs text-muted-foreground">{hint}</span>}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {t("counts", { passages: node.passages, questions: node.questions })}
      </span>
    </label>
  );
}
