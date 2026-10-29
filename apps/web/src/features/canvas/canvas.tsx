"use client";

import type { EditOp, PaperDocument } from "@vidyam/contracts";
import { Badge } from "@vidyam/ui/components/badge";
import { Button } from "@vidyam/ui/components/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@vidyam/ui/components/select";
import { Skeleton } from "@vidyam/ui/components/skeleton";
import { Switch } from "@vidyam/ui/components/switch";
import { History, Loader2, Undo2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { useDocument, useEdit, useRestore } from "./api";
import { NotesView } from "./notes-view";
import { PaperView } from "./paper-view";
import { VersionHistory } from "./version-history";

const PAPER_ORDER = "__paper__";
const MAKING = new Set(["planning", "running"]);

/**
 * The canvas (plan v3 §2): the document the chat made, beside the chat. Items fill in while it is being made;
 * once it is, the teacher edits it by hand, looks through its versions and undoes. Every change is a new
 * version, made against the version on screen.
 */
export function Canvas({ documentId, onClose }: { documentId: string; onClose: () => void }) {
  const t = useTranslations("canvas");
  const document = useDocument(documentId);
  const edit = useEdit(documentId);
  const restore = useRestore(documentId);
  const [setCode, setSetCode] = useState<string | null>(null);
  const [showAnswers, setShowAnswers] = useState(true);
  const [history, setHistory] = useState(false);
  const detail = document.data;
  const making = MAKING.has(detail?.generation?.status ?? "");
  const version = detail?.document.currentVersion ?? 0;
  const editable = !making && version > 0;
  const saving = edit.isPending || restore.isPending;
  const sets = detail && "slots" in detail.content ? (detail.content as PaperDocument).sets : [];

  function change(ops: EditOp[]) {
    edit.mutate({ baseVersion: version, ops });
  }

  return (
    <aside
      aria-label={t("label")}
      className="fixed inset-0 z-40 flex flex-col bg-background lg:static lg:z-auto lg:w-[52%] lg:shrink-0 lg:border-l"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <h2 className="truncate text-sm font-medium">{detail?.document.title ?? "…"}</h2>
        {detail && (
          <Badge variant="secondary" className="shrink-0">
            {making ? (
              <>
                <Loader2 className="animate-spin" />
                {t("making", { done: detail.generation!.done, total: detail.generation!.total })}
              </>
            ) : (
              t("version", { version })
            )}
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={!editable || version < 2 || saving}
            onClick={() => restore.mutate({ baseVersion: version, version: version - 1 })}
          >
            <Undo2 />
            {t("undo")}
          </Button>
          <Button variant="ghost" size="sm" disabled={version < 1} onClick={() => setHistory(true)}>
            <History />
            {t("history")}
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={t("close")} onClick={onClose}>
            <X />
          </Button>
        </div>
      </header>
      {detail && detail.content.spec.kind !== "notes" && detail.content.spec.kind !== "revision_sheet" && (
        <div className="flex shrink-0 flex-wrap items-center gap-4 border-b px-4 py-2 text-sm">
          <label className="flex items-center gap-2">
            <Switch checked={showAnswers} onCheckedChange={setShowAnswers} />
            {t("answers")}
          </label>
          {sets.length > 0 && (
            <Select
              value={setCode ?? PAPER_ORDER}
              onValueChange={(v) => setSetCode(v === PAPER_ORDER ? null : v)}
            >
              <SelectTrigger size="sm" aria-label={t("set")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PAPER_ORDER}>{t("paperOrder")}</SelectItem>
                {sets.map((set) => (
                  <SelectItem key={set.code} value={set.code}>
                    {t("setCode", { code: set.code })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {setCode && <span className="text-xs text-muted-foreground">{t("setHint")}</span>}
        </div>
      )}
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-6">
          {document.isPending ? (
            <Skeleton className="h-96 w-full" />
          ) : document.isError ? (
            <p className="text-sm text-destructive">{document.error.message}</p>
          ) : detail!.content.spec.kind === "notes" || detail!.content.spec.kind === "revision_sheet" ? (
            <NotesView detail={detail!} editable={editable} saving={saving} edit={change} />
          ) : (
            <PaperView
              detail={detail!}
              setCode={setCode}
              showAnswers={showAnswers}
              editable={editable}
              saving={saving}
              edit={change}
            />
          )}
        </div>
      </div>
      {history && detail && <VersionHistory detail={detail} onClose={() => setHistory(false)} />}
    </aside>
  );
}
