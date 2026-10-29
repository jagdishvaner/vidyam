"use client";

import type { DocumentDetail, EditOp, NotesDocument, NotesSection } from "@vidyam/contracts";
import { Badge } from "@vidyam/ui/components/badge";
import { Button } from "@vidyam/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@vidyam/ui/components/dialog";
import { Label } from "@vidyam/ui/components/label";
import { Skeleton } from "@vidyam/ui/components/skeleton";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Loader2,
  Pencil,
  PenLine,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { Markdown } from "@/features/chat/markdown";

import { localized } from "./paper-view";
import { textareaClass } from "./question-editor";

const STATES: Record<
  NotesSection["state"],
  { icon: LucideIcon; variant: "secondary" | "outline" | "destructive" }
> = {
  pending: { icon: Loader2, variant: "outline" },
  written: { icon: PenLine, variant: "secondary" },
  verified: { icon: CheckCircle2, variant: "secondary" },
  flagged: { icon: AlertTriangle, variant: "destructive" },
  insufficient_evidence: { icon: AlertTriangle, variant: "outline" },
  edited: { icon: PenLine, variant: "secondary" },
};

/** Notes or a revision sheet on the canvas: a section per chapter or topic, each with its sources. */
export function NotesView({
  detail,
  editable,
  saving,
  edit,
}: {
  detail: DocumentDetail;
  editable: boolean;
  saving: boolean;
  edit: (ops: EditOp[]) => void;
}) {
  const t = useTranslations("canvas");
  const locale = useLocale();
  const notes = detail.content as NotesDocument;
  const [editing, setEditing] = useState<NotesSection | null>(null);
  return (
    <div className="space-y-8">
      {notes.sections.map((section) => {
        const { icon: Icon, variant } = STATES[section.state];
        const bodies = (["hi", "en"] as const).flatMap((lang) =>
          section.body[lang] ? [[lang, section.body[lang]!] as const] : [],
        );
        return (
          <section key={section.nodeId} className="space-y-3" aria-label={localized(locale, section.title)}>
            <header className="flex items-center gap-2 border-b pb-2">
              <h3 className="font-semibold">{localized(locale, section.title)}</h3>
              <Badge variant={variant} className="ml-auto">
                <Icon className={section.state === "pending" ? "animate-spin" : undefined} />
                {t(`state.${section.state}`)}
              </Badge>
              {editable && (
                <>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("actions.edit")}
                    disabled={saving}
                    onClick={() => setEditing(section)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("actions.remove")}
                    disabled={saving || notes.sections.length < 2}
                    onClick={() => edit([{ op: "delete_sections", nodeIds: [section.nodeId] }])}
                  >
                    <Trash2 />
                  </Button>
                </>
              )}
            </header>
            {section.state === "pending" && <Skeleton className="h-24 w-full" />}
            {section.state === "insufficient_evidence" && !bodies.length && (
              <p className="text-sm text-muted-foreground">{t("empty.material")}</p>
            )}
            {bodies.map(([lang, body]) => (
              <div key={lang} lang={lang} className="text-sm">
                <Markdown text={body} />
              </div>
            ))}
            {section.flags.length > 0 && section.state !== "insufficient_evidence" && (
              <ul className="list-disc pl-5 text-xs text-destructive">
                {section.flags.map((flag) => (
                  <li key={flag}>{flag}</li>
                ))}
              </ul>
            )}
            {section.citations.length > 0 && (
              <div className="space-y-1 rounded-lg border bg-muted/30 p-3 text-xs">
                <p className="flex items-center gap-1.5 font-medium">
                  <BookOpen className="size-3.5" />
                  {t("sources")}
                </p>
                <ol className="space-y-1">
                  {section.citations.map((source, n) => (
                    <li key={source.chunkId} className="flex gap-2">
                      <span className="tabular-nums text-muted-foreground">[{n + 1}]</span>
                      {t("source", {
                        file: source.filename,
                        page: source.pageLabel ?? String(source.pageStart ?? "?"),
                      })}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </section>
        );
      })}
      {editing && (
        <SectionEditor
          section={editing}
          languages={notes.spec.languages.filter((l): l is "hi" | "en" => l === "hi" || l === "en")}
          saving={saving}
          onClose={() => setEditing(null)}
          onSave={(body) => {
            edit([{ op: "edit_section", nodeId: editing.nodeId, body }]);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function SectionEditor({
  section,
  languages,
  saving,
  onSave,
  onClose,
}: {
  section: NotesSection;
  languages: ("hi" | "en")[];
  saving: boolean;
  onSave: (body: NotesSection["body"]) => void;
  onClose: () => void;
}) {
  const t = useTranslations("canvas.editor");
  const locale = useLocale();
  const [body, setBody] = useState({ hi: section.body.hi ?? "", en: section.body.en ?? "" });
  const written = languages.filter((lang) => body[lang].trim());
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(Object.fromEntries(written.map((lang) => [lang, body[lang].trim()])));
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{localized(locale, section.title)}</DialogTitle>
          <DialogDescription>{t("sectionHint")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {languages.map((lang) => (
            <div key={lang} className="space-y-1.5">
              <Label htmlFor={`body-${lang}`}>{t(lang === "hi" ? "hindi" : "english")}</Label>
              <textarea
                id={`body-${lang}`}
                lang={lang}
                className={`${textareaClass} min-h-60 font-mono`}
                value={body[lang]}
                onChange={(e) => setBody((current) => ({ ...current, [lang]: e.target.value }))}
              />
            </div>
          ))}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={saving || !written.length}>
              {t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
