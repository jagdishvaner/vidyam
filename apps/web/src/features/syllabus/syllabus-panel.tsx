"use client";

import type { SyllabusNode } from "@vidyam/contracts";
import { Badge } from "@vidyam/ui/components/badge";
import { Button } from "@vidyam/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@vidyam/ui/components/card";
import { Skeleton } from "@vidyam/ui/components/skeleton";
import { cn } from "@vidyam/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Pencil, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { api } from "@/lib/client/api";
import { errorMessage } from "@/lib/client/errors";

import { JsonImportButton } from "./json-import-button";
import { NodeDialog, type NodeDialogState } from "./node-dialog";

/** Chapters show when a subject opens; topics open per chapter. */
const OPEN_BY_DEFAULT = new Set(["subject", "unit"]);

export function SyllabusPanel() {
  const t = useTranslations("syllabus");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<NodeDialogState | null>(null);

  const overview = useQuery({
    queryKey: ["syllabus"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/syllabus");
      if (error || !data) throw new Error(errorMessage(error, tc("somethingWentWrong")));
      return data;
    },
  });
  const selected = subjectId ?? overview.data?.subjects[0]?.id ?? null;
  const subject = useQuery({
    queryKey: ["syllabus", selected],
    enabled: selected !== null,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/syllabus/subjects/{subjectId}", {
        params: { path: { subjectId: selected! } },
      });
      if (error || !data) throw new Error(errorMessage(error, tc("somethingWentWrong")));
      return data;
    },
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["syllabus"] });

  return (
    <div className="grid gap-6 xl:grid-cols-[16rem_minmax(0,1fr)]">
      <Card className="self-start">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t("subjects")}</CardTitle>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("addSubject")}
            onClick={() => setDialog({ mode: "add", parent: null })}
          >
            <Plus />
          </Button>
        </CardHeader>
        <CardContent className="space-y-1">
          {overview.isPending && <Skeleton className="h-48 w-full" />}
          {/* Retired subjects stay listed (content may still be tagged with them), after the ones in use. */}
          {[...(overview.data?.subjects ?? [])]
            .sort((a, b) => Number(b.isActive) - Number(a.isActive))
            .map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSubjectId(s.id)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent",
                  s.id === selected && "bg-accent font-medium",
                  !s.isActive && "opacity-50",
                )}
              >
                <NodeName node={s} />
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t("nodes", { count: s.descendants })}
                </span>
              </button>
            ))}
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            {subject.data ? <NodeName node={subject.data.subject} /> : t("pickSubject")}
            {subject.data && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={`${t("edit")}: ${subject.data.subject.nameEn}`}
                onClick={() => setDialog({ mode: "edit", node: subject.data.subject })}
              >
                <Pencil />
              </Button>
            )}
          </CardTitle>
          <JsonImportButton
            label={t("importSyllabus")}
            send={async (json) => {
              const { data, error } = await api.POST("/api/syllabus/import", { body: json as never });
              if (error || !data) throw new Error(errorMessage(error, tc("somethingWentWrong")));
              return data;
            }}
            onDone={refresh}
          />
        </CardHeader>
        <CardContent>
          {subject.isPending && selected && <Skeleton className="h-96 w-full" />}
          {subject.data && (
            <Tree
              root={subject.data.subject}
              nodes={subject.data.nodes}
              onEdit={(node) => setDialog({ mode: "edit", node })}
              onAdd={(parent) => setDialog({ mode: "add", parent })}
            />
          )}
        </CardContent>
      </Card>

      <NodeDialog
        state={dialog}
        onClose={() => setDialog(null)}
        onDone={(node) => {
          setDialog(null);
          if (node.level === "subject") setSubjectId(node.id);
          refresh();
        }}
      />
    </div>
  );
}

function NodeName({ node }: { node: SyllabusNode }) {
  const locale = useLocale();
  const [first, second] =
    locale === "hi" ? [node.nameHi ?? node.nameEn, node.nameEn] : [node.nameEn, node.nameHi];
  return (
    <span className="min-w-0">
      <span>{first}</span>
      {second && second !== first && <span className="ml-2 text-muted-foreground">{second}</span>}
    </span>
  );
}

function Tree({
  root,
  nodes,
  onEdit,
  onAdd,
}: {
  root: SyllabusNode;
  nodes: SyllabusNode[];
  onEdit: (node: SyllabusNode) => void;
  onAdd: (parent: SyllabusNode) => void;
}) {
  const t = useTranslations("syllabus");
  const { depth, childCount } = useMemo(() => {
    const depth = new Map<string, number>([[root.id, -1]]);
    const childCount = new Map<string, number>();
    for (const node of nodes) {
      depth.set(node.id, (depth.get(node.parentId ?? "") ?? -1) + 1);
      if (node.parentId) childCount.set(node.parentId, (childCount.get(node.parentId) ?? 0) + 1);
    }
    return { depth, childCount };
  }, [root.id, nodes]);
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const isOpen = (node: SyllabusNode) => OPEN_BY_DEFAULT.has(node.level) !== toggled.has(node.id);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const visible = (node: SyllabusNode): boolean => {
    for (let parent = byId.get(node.parentId ?? ""); parent; parent = byId.get(parent.parentId ?? "")) {
      if (!isOpen(parent)) return false;
    }
    return true;
  };
  const toggle = (id: string) =>
    setToggled((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="space-y-px">
      <div className="flex justify-end pb-2">
        <Button variant="outline" size="sm" onClick={() => onAdd(root)}>
          <Plus data-icon="inline-start" />
          {t("addChild")}
        </Button>
      </div>
      {nodes.filter(visible).map((node) => {
        const children = childCount.get(node.id) ?? 0;
        const open = isOpen(node);
        return (
          <div
            key={node.id}
            className={cn(
              "group flex items-center gap-2 rounded-md py-1.5 pr-2 text-sm hover:bg-accent/60",
              !node.isActive && "opacity-50",
            )}
            style={{ paddingLeft: `${(depth.get(node.id) ?? 0) * 1.25 + 0.25}rem` }}
          >
            {children > 0 ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label={t(open ? "collapse" : "expand", { name: node.nameEn })}
                aria-expanded={open}
                onClick={() => toggle(node.id)}
              >
                <ChevronRight className={cn("transition-transform", open && "rotate-90")} />
              </Button>
            ) : (
              <span className="size-6 shrink-0" />
            )}
            <NodeName node={node} />
            <Badge variant="outline" className="text-[10px]">
              {t(`levels.${node.level}`)}
            </Badge>
            {!node.isActive && <Badge variant="secondary">{t("inactive")}</Badge>}
            {node.aliases.length > 0 && (
              <span
                className="hidden text-xs text-muted-foreground sm:inline"
                title={node.aliases.join(", ")}
              >
                {t("aliasCount", { count: node.aliases.length })}
              </span>
            )}
            <span className="ml-auto flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={`${t("edit")}: ${node.nameEn}`}
                onClick={() => onEdit(node)}
              >
                <Pencil />
              </Button>
              {node.level !== "subtopic" && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={`${t("addChild")}: ${node.nameEn}`}
                  onClick={() => onAdd(node)}
                >
                  <Plus />
                </Button>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
