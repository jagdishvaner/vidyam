"use client";

import { QuestionType, type ExamPaper, type PaperPattern } from "@vidyam/contracts";
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
import { Input } from "@vidyam/ui/components/input";
import { Label } from "@vidyam/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@vidyam/ui/components/select";
import { cn } from "@vidyam/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { api } from "@vidyam/app-shell/client/api";
import { errorMessage } from "@vidyam/app-shell/client/errors";

import {
  draftTotals,
  newSection,
  toBlueprint,
  toDraft,
  type MixDraft,
  type PatternDraft,
  type SectionDraft,
} from "./draft";

/** Parts of the syllabus a section can draw from: the paper's subjects and the parts it links. */
export interface ScopeOption {
  path: string;
  nameEn: string;
  nameHi: string | null;
}

export type EditorState = { exam: ExamPaper; pattern: PaperPattern | null; scopeOptions: ScopeOption[] };

const TEXTAREA =
  "w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function PatternEditor({
  state,
  onClose,
  onDone,
}: {
  state: EditorState | null;
  onClose: () => void;
  onDone: () => void;
}) {
  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-4xl">
        {state && (
          <EditorForm key={state.pattern?.id ?? "new"} state={state} onClose={onClose} onDone={onDone} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditorForm({
  state,
  onClose,
  onDone,
}: {
  state: EditorState;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("patterns");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { exam, pattern } = state;
  const [draft, setDraft] = useState<PatternDraft>(() =>
    toDraft(pattern?.name ?? "", pattern?.blueprint ?? null),
  );
  const examName = (locale === "hi" && exam.nameHi) || exam.nameEn;
  const totals = draftTotals(draft);

  const save = useMutation({
    mutationFn: async () => {
      const result = toBlueprint(draft);
      if ("error" in result) throw new Error(t(result.error));
      const body = { examId: exam.id, name: draft.name.trim(), blueprint: result.blueprint };
      const { data, error } = pattern
        ? await api.PUT("/api/patterns/{patternId}", { params: { path: { patternId: pattern.id } }, body })
        : await api.POST("/api/patterns", { body });
      if (error || !data) throw new Error(errorMessage(error, tc("somethingWentWrong")));
      return data;
    },
    onSuccess: (saved) => {
      toast.success(t("saved", { name: saved.name }));
      onDone();
    },
    onError: (error) => toast.error(error.message),
  });

  const setSection = (index: number, change: Partial<SectionDraft>) =>
    setDraft((d) => ({ ...d, sections: d.sections.map((s, i) => (i === index ? { ...s, ...change } : s)) }));

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <DialogHeader>
        <DialogTitle>
          {pattern ? t("editorEdit", { name: pattern.name }) : t("editorNew", { exam: examName })}
        </DialogTitle>
        <DialogDescription>{t("editorBody")}</DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <Field label={t("name")}>
          {(id) => (
            <Input
              id={id}
              required
              maxLength={120}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          )}
        </Field>
        <Field label={t("duration")}>
          {(id) => (
            <Input
              id={id}
              type="number"
              required
              min={1}
              value={draft.durationMinutes}
              onChange={(e) => setDraft({ ...draft, durationMinutes: e.target.value })}
            />
          )}
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("instructionsHi")}>
          {(id) => (
            <textarea
              id={id}
              lang="hi"
              rows={3}
              className={TEXTAREA}
              value={draft.instructionsHi}
              onChange={(e) => setDraft({ ...draft, instructionsHi: e.target.value })}
            />
          )}
        </Field>
        <Field label={t("instructionsEn")}>
          {(id) => (
            <textarea
              id={id}
              rows={3}
              className={TEXTAREA}
              value={draft.instructionsEn}
              onChange={(e) => setDraft({ ...draft, instructionsEn: e.target.value })}
            />
          )}
        </Field>
      </div>

      <MixInputs label={t("defaultMix")} mix={draft.mix} onChange={(mix) => setDraft({ ...draft, mix })} />

      <div className="space-y-4">
        {draft.sections.map((section, index) => (
          <SectionEditor
            key={index}
            index={index}
            section={section}
            scopeOptions={state.scopeOptions}
            canRemove={draft.sections.length > 1}
            onChange={(change) => setSection(index, change)}
            onRemove={() => setDraft((d) => ({ ...d, sections: d.sections.filter((_, i) => i !== index) }))}
          />
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() => setDraft((d) => ({ ...d, sections: [...d.sections, newSection(d.mix)] }))}
        >
          <Plus data-icon="inline-start" />
          {t("addSection")}
        </Button>
      </div>

      <DialogFooter className="items-center sm:justify-between">
        <p className="text-sm text-muted-foreground tabular-nums">
          {t("totals", {
            questions: totals.questions,
            marks: totals.marks,
            minutes: draft.durationMinutes || 0,
          })}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? t("saving") : t("save")}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}

function SectionEditor({
  index,
  section,
  scopeOptions,
  canRemove,
  onChange,
  onRemove,
}: {
  index: number;
  section: SectionDraft;
  scopeOptions: ScopeOption[];
  canRemove: boolean;
  onChange: (change: Partial<SectionDraft>) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("patterns");
  const locale = useLocale();
  const number = index + 1;
  const toggleScope = (path: string) =>
    onChange({
      scope: section.scope.includes(path)
        ? section.scope.filter((p) => p !== path)
        : [...section.scope, path],
    });

  return (
    <fieldset className="space-y-4 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <legend className="text-sm font-medium">
          {t("section")} {number}
        </legend>
        {canRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("removeSection", { number })}
            onClick={onRemove}
          >
            <Trash2 />
          </Button>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("sectionNameEn")}>
          {(id) => (
            <Input id={id} value={section.nameEn} onChange={(e) => onChange({ nameEn: e.target.value })} />
          )}
        </Field>
        <Field label={t("sectionNameHi")}>
          {(id) => (
            <Input
              id={id}
              lang="hi"
              value={section.nameHi}
              onChange={(e) => onChange({ nameHi: e.target.value })}
            />
          )}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-5">
        <Field label={t("type")} className="sm:col-span-2">
          {(id) => (
            <Select
              value={section.qtype}
              onValueChange={(qtype) => onChange({ qtype: qtype as SectionDraft["qtype"] })}
            >
              <SelectTrigger id={id} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QuestionType.options.map((q) => (
                  <SelectItem key={q} value={q}>
                    {t(`questionTypes.${q}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
        <Field label={t("count")}>
          {(id) => (
            <Input
              id={id}
              type="number"
              required
              min={1}
              value={section.count}
              onChange={(e) => onChange({ count: e.target.value })}
            />
          )}
        </Field>
        <Field label={t("marksEach")}>
          {(id) => (
            <Input
              id={id}
              type="number"
              required
              min={0.25}
              step="0.25"
              value={section.marksEach}
              onChange={(e) => onChange({ marksEach: e.target.value })}
            />
          )}
        </Field>
        <Field label={t("negative")}>
          {(id) => (
            <Input
              id={id}
              type="number"
              min={0}
              step="0.01"
              value={section.negativeMarks}
              onChange={(e) => onChange({ negativeMarks: e.target.value })}
            />
          )}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <Field label={t("attemptAny")} hint={t("attemptAnyHint")}>
          {(id) => (
            <Input
              id={id}
              type="number"
              min={1}
              max={Number(section.count) || undefined}
              value={section.attemptAny}
              onChange={(e) => onChange({ attemptAny: e.target.value })}
            />
          )}
        </Field>
        <div className="space-y-2">
          <p className="text-sm font-medium">{t("scope")}</p>
          <div className="flex flex-wrap gap-1">
            {scopeOptions.map((part) => {
              const on = section.scope.includes(part.path);
              return (
                <button
                  key={part.path}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleScope(part.path)}
                  title={part.path}
                >
                  <Badge variant={on ? "default" : "outline"} className={cn(!on && "text-muted-foreground")}>
                    {(locale === "hi" && part.nameHi) || part.nameEn}
                  </Badge>
                </button>
              );
            })}
          </div>
          {section.scope.length === 0 && <p className="text-xs text-muted-foreground">{t("wholePaper")}</p>}
        </div>
      </div>
      <MixInputs label={t("difficulty")} mix={section.mix} onChange={(mix) => onChange({ mix })} />
    </fieldset>
  );
}

function MixInputs({
  label,
  mix,
  onChange,
}: {
  label: string;
  mix: MixDraft;
  onChange: (mix: MixDraft) => void;
}) {
  const t = useTranslations("patterns");
  const sum = Number(mix.easy) + Number(mix.medium) + Number(mix.hard);
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex flex-wrap items-end gap-3">
        {(["easy", "medium", "hard"] as const).map((level) => (
          <Field key={level} label={t(level)} className="w-24">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0}
                max={100}
                value={mix[level]}
                onChange={(e) => onChange({ ...mix, [level]: e.target.value })}
              />
            )}
          </Field>
        ))}
        {sum !== 100 && <p className="pb-2 text-xs text-destructive">{t("mixMustAdd")}</p>}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children(id)}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
