"use client";

import type { CanvasQuestion, DocumentDetail, EditOp, PaperDocument, PaperSlot } from "@vidyam/contracts";
import { Badge } from "@vidyam/ui/components/badge";
import { Button } from "@vidyam/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@vidyam/ui/components/dropdown-menu";
import { Skeleton } from "@vidyam/ui/components/skeleton";
import { cn } from "@vidyam/ui/lib/utils";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BookCheck,
  CheckCircle2,
  Loader2,
  MoreHorizontal,
  Pencil,
  PenLine,
  Sparkles,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { Markdown } from "@/features/chat/markdown";

import { QuestionEditor } from "./question-editor";

const LETTERS = ["A", "B", "C", "D", "E", "F"];

/** Each slot state's badge: what it says, and how loudly. */
const STATES: Record<
  PaperSlot["state"],
  { icon: LucideIcon; variant: "secondary" | "outline" | "destructive" }
> = {
  pending: { icon: Loader2, variant: "outline" },
  bank: { icon: BookCheck, variant: "secondary" },
  generated: { icon: Sparkles, variant: "secondary" },
  verified: { icon: CheckCircle2, variant: "secondary" },
  flagged: { icon: AlertTriangle, variant: "destructive" },
  insufficient_evidence: { icon: AlertTriangle, variant: "outline" },
  edited: { icon: PenLine, variant: "secondary" },
};

export function StateBadge({ state }: { state: PaperSlot["state"] }) {
  const t = useTranslations("canvas.state");
  const { icon: Icon, variant } = STATES[state];
  return (
    <Badge variant={variant} className="shrink-0">
      <Icon className={cn(state === "pending" && "animate-spin")} />
      {t(state)}
    </Badge>
  );
}

export function localized(locale: string, text: { en?: string; hi?: string } | null | undefined): string {
  if (!text) return "";
  return (locale === "hi" ? (text.hi ?? text.en) : (text.en ?? text.hi)) ?? "";
}

/**
 * A paper on the canvas: its sections and numbered items, in the paper's order or a booklet set's (with that
 * set's option order and key). Items are edited, removed and moved here; a set's view is for reading.
 */
export function PaperView({
  detail,
  setCode,
  showAnswers,
  editable,
  saving,
  edit,
}: {
  detail: DocumentDetail;
  setCode: string | null;
  showAnswers: boolean;
  editable: boolean;
  saving: boolean;
  edit: (ops: EditOp[]) => void;
}) {
  const t = useTranslations("canvas");
  const locale = useLocale();
  const paper = detail.content as PaperDocument;
  const set = paper.sets.find((s) => s.code === setCode) ?? null;
  const bySlot = new Map(paper.slots.map((slot) => [slot.slotId, slot]));
  const [editing, setEditing] = useState<PaperSlot | null>(null);
  const languages = paper.spec.languages.filter((l): l is "hi" | "en" => l === "hi" || l === "en");
  // Questions are numbered through the paper, in the order shown (the paper's, or the set's).
  const orders = paper.sections.map((section) =>
    set ? set.slotOrder.filter((id) => section.slotIds.includes(id)) : section.slotIds,
  );
  const starts = orders.map((_, n) => orders.slice(0, n).reduce((sum, ids) => sum + ids.length, 0));

  return (
    <div className="space-y-8">
      {paper.sections.map((section, index) => {
        const ids = orders[index]!;
        const spec = paper.spec.sections[index];
        return (
          <section key={index} className="space-y-4">
            <header className="border-b pb-2">
              <h3 className="font-semibold">
                {localized(locale, section.name) || t("section", { n: index + 1 })}
              </h3>
              {spec && (
                <p className="text-xs text-muted-foreground">
                  {t("sectionMarks", { marks: spec.marksEach, negative: spec.negativeMarks })}
                </p>
              )}
              {section.instructions && (
                <p className="mt-1 text-sm">{localized(locale, section.instructions)}</p>
              )}
            </header>
            <ol className="space-y-5">
              {ids.map((id, position) => {
                const slot = bySlot.get(id)!;
                return (
                  <Item
                    key={id}
                    number={starts[index]! + position + 1}
                    slot={slot}
                    question={slot.questionId ? (detail.questions[slot.questionId] ?? null) : null}
                    optionOrder={set?.optionOrder[id] ?? null}
                    showAnswers={showAnswers}
                    chapter={localized(locale, detail.nodeNames[slot.taxonomyNodeId])}
                    menu={
                      editable && !set ? (
                        <ItemMenu
                          disabled={saving}
                          first={position === 0}
                          last={position === ids.length - 1}
                          onEdit={() => setEditing(slot)}
                          onRemove={() => edit([{ op: "delete_items", slotIds: [id] }])}
                          onMove={(by) => {
                            const order = [...section.slotIds];
                            order.splice(position, 1);
                            order.splice(position + by, 0, id);
                            edit([{ op: "reorder", slotIds: order }]);
                          }}
                        />
                      ) : null
                    }
                  />
                );
              })}
            </ol>
          </section>
        );
      })}
      {editing && (
        <QuestionEditor
          qtype={editing.qtype}
          question={editing.questionId ? (detail.questions[editing.questionId] ?? null) : null}
          languages={languages}
          saving={saving}
          onClose={() => setEditing(null)}
          onSave={(content, answer) => {
            edit([{ op: "edit_item", slotId: editing.slotId, content, answer }]);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function Item({
  number,
  slot,
  question,
  optionOrder,
  showAnswers,
  chapter,
  menu,
}: {
  number: number;
  slot: PaperSlot;
  question: CanvasQuestion | null;
  optionOrder: string[] | null;
  showAnswers: boolean;
  chapter: string;
  menu: React.ReactNode;
}) {
  const t = useTranslations("canvas");
  const versions = question
    ? (["hi", "en"] as const).flatMap((lang) =>
        question.content[lang] ? [[lang, question.content[lang]!] as const] : [],
      )
    : [];
  return (
    <li className="group space-y-2" data-slot-id={slot.slotId} aria-label={t("item", { number })}>
      <div className="flex items-start gap-2">
        <span className="w-7 shrink-0 pt-0.5 text-sm font-medium tabular-nums">{number}.</span>
        <div className="min-w-0 flex-1 space-y-3">
          {versions.length === 0 &&
            (slot.state === "pending" ? (
              <Skeleton className="h-12 w-full" />
            ) : (
              <p className="text-sm text-muted-foreground">
                {t(`empty.${slot.state === "insufficient_evidence" ? "material" : "none"}`)}
              </p>
            ))}
          {versions.map(([lang, version]) => {
            const keys = optionOrder ?? version.options.map((o) => o.key);
            return (
              <div key={lang} lang={lang} className="space-y-1.5 text-sm">
                <Markdown text={version.stem} />
                {version.options.length > 0 && (
                  <ol className="grid gap-1 sm:grid-cols-2">
                    {keys.map((key, n) => {
                      const option = version.options.find((o) => o.key === key);
                      if (!option) return null;
                      const right =
                        showAnswers &&
                        question!.answer.kind === "options" &&
                        question!.answer.keys.includes(key);
                      return (
                        <li
                          key={key}
                          className={cn("flex gap-2 rounded px-1", right && "bg-primary/10 font-medium")}
                        >
                          <span className="text-muted-foreground">({optionOrder ? LETTERS[n] : key})</span>
                          <Markdown text={option.text} />
                        </li>
                      );
                    })}
                  </ol>
                )}
                {showAnswers && version.solution && (
                  <details className="text-muted-foreground">
                    <summary className="cursor-pointer text-xs">{t("solution")}</summary>
                    <Markdown text={version.solution} />
                  </details>
                )}
              </div>
            );
          })}
          {showAnswers && question && <AnswerLine question={question} optionOrder={optionOrder} />}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StateBadge state={slot.state} />
            <span>{t("marks", { marks: slot.marks })}</span>
            {chapter && <span>· {chapter}</span>}
            {question?.sources[0] && (
              <span>
                ·{" "}
                {t("source", {
                  file: question.sources[0].filename,
                  page: question.sources[0].pageLabel ?? String(question.sources[0].pageStart ?? "?"),
                })}
              </span>
            )}
          </div>
          {slot.flags.length > 0 && (question || slot.state === "flagged") && (
            <ul className="list-disc pl-5 text-xs text-destructive">
              {slot.flags.map((flag) => (
                <li key={flag}>{flag}</li>
              ))}
            </ul>
          )}
        </div>
        {menu}
      </div>
    </li>
  );
}

function AnswerLine({ question, optionOrder }: { question: CanvasQuestion; optionOrder: string[] | null }) {
  const t = useTranslations("canvas");
  const answer = question.answer;
  const text =
    answer.kind === "options"
      ? answer.keys.map((key) => (optionOrder ? LETTERS[optionOrder.indexOf(key)] : key)).join(", ")
      : answer.kind === "numeric"
        ? String(answer.value)
        : answer.kind === "text"
          ? answer.modelAnswer
          : t("noAnswer");
  return <p className="text-sm font-medium">{t("answer", { answer: text })}</p>;
}

function ItemMenu({
  disabled,
  first,
  last,
  onEdit,
  onRemove,
  onMove,
}: {
  disabled: boolean;
  first: boolean;
  last: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onMove: (by: number) => void;
}) {
  const t = useTranslations("canvas.actions");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("menu")} disabled={disabled}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil />
          {t("edit")}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={first} onSelect={() => onMove(-1)}>
          <ArrowUp />
          {t("moveUp")}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={last} onSelect={() => onMove(1)}>
          <ArrowDown />
          {t("moveDown")}
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={onRemove}>
          <Trash2 />
          {t("remove")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
