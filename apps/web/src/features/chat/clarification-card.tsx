"use client";

import type { CardField, ChatBlock, PaperSection } from "@vidyam/contracts";
import { Button } from "@vidyam/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@vidyam/ui/components/card";
import { Checkbox } from "@vidyam/ui/components/checkbox";
import { Input } from "@vidyam/ui/components/input";
import { Label } from "@vidyam/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@vidyam/ui/components/select";
import { Switch } from "@vidyam/ui/components/switch";
import { Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { useExams, usePatterns } from "./api";
import type { ChatInput } from "./conversation";
import { DEPTHS, KINDS, LANGUAGES, LAYOUTS, QUESTION_TYPES, SOURCINGS, localName, useLabels } from "./labels";
import { ScopePicker } from "./scope-picker";

type Clarification = Extract<ChatBlock, { type: "clarification" }>;
type Values = Record<string, unknown>;

const NONE = "__none__";
const MIX = { easy: 0.3, medium: 0.5, hard: 0.2 };
const PRESETS = {
  easy: { easy: 0.6, medium: 0.3, hard: 0.1 },
  medium: { easy: 0.3, medium: 0.5, hard: 0.2 },
  hard: { easy: 0.1, medium: 0.4, hard: 0.5 },
} as const;
/** Fields the card doesn't show yet: student batches come with the question bank's history. */
const HIDDEN = new Set(["student_batch"]);

function opening(field: CardField): unknown {
  if (field.suggested !== undefined && field.suggested !== null) return field.suggested;
  switch (field.key) {
    case "taxonomy_nodes":
    case "sections":
    case "set_codes":
      return [];
    case "languages":
      return ["hi", "en"];
    case "difficulty_mix":
      return MIX;
    case "include_examples":
      return true;
    case "include_practice":
      return false;
    default:
      return null;
  }
}

/**
 * A clarification card (ADR 0015): asks only for what the chat still needs, each field opening with what it
 * understood. Answering it costs nothing: no model reads it.
 */
export function ClarificationCard({
  block,
  live,
  send,
}: {
  block: Clarification;
  live: boolean;
  send: (input: ChatInput) => void;
}) {
  const t = useTranslations("chat.card");
  const fields = block.fields.filter((field) => !HIDDEN.has(field.key));
  const [values, setValues] = useState<Values>(() =>
    Object.fromEntries(fields.map((field) => [field.key, opening(field)])),
  );
  const set = (key: string) => (value: unknown) => setValues((current) => ({ ...current, [key]: value }));
  const missing = fields.some((field) => {
    const value = values[field.key];
    return field.required && (value === null || value === "" || (Array.isArray(value) && value.length === 0));
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send({ kind: "card_submit", cardId: block.cardId, values });
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{t(block.purpose === "scope" ? "scopeTitle" : "shapeTitle")}</CardTitle>
        <CardDescription>{t(block.purpose === "scope" ? "scopeHint" : "shapeHint")}</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit}>
        <fieldset disabled={!live} className="contents">
          <CardContent className="space-y-5">
            {fields.map((field) => (
              <FieldEditor key={field.key} field={field} values={values} onChange={set(field.key)} />
            ))}
          </CardContent>
          {live && (
            <CardFooter className="mt-5 justify-end">
              <Button type="submit" disabled={missing}>
                {t("continue")}
              </Button>
            </CardFooter>
          )}
        </fieldset>
      </form>
    </Card>
  );
}

function FieldEditor({
  field,
  values,
  onChange,
}: {
  field: CardField;
  values: Values;
  onChange: (value: unknown) => void;
}) {
  const t = useTranslations("chat.card");
  const labels = useLabels();
  const locale = useLocale();
  const exams = useExams();
  const value = values[field.key];
  const examCode = typeof values.exam === "string" ? values.exam : null;
  const examId = exams.data?.find((exam) => exam.code === examCode)?.id ?? null;
  const patterns = usePatterns(field.key === "blueprint" ? examId : null);
  const label = (
    <Label className="text-sm">
      {t(`fields.${field.key}` as never)}
      {field.required && <span className="text-destructive"> *</span>}
    </Label>
  );

  const choice = (options: readonly string[], name: (value: string) => string, allowNone = false) => (
    <Select
      value={typeof value === "string" ? value : NONE}
      onValueChange={(v) => onChange(v === NONE ? null : v)}
    >
      <SelectTrigger className="w-full" aria-label={t(`fields.${field.key}` as never)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(allowNone || value === null) && <SelectItem value={NONE}>{t("none")}</SelectItem>}
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {name(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  let editor;
  switch (field.key) {
    case "kind":
      editor = choice(KINDS, labels.kind);
      break;
    case "exam":
      editor = choice(
        (exams.data ?? []).map((exam) => exam.code),
        (code) => {
          const exam = exams.data?.find((e) => e.code === code);
          return exam ? localName(locale, exam) : code;
        },
        true,
      );
      break;
    case "blueprint":
      editor = choice(
        (patterns.data ?? []).map((pattern) => pattern.id),
        (id) => {
          const pattern = patterns.data?.find((p) => p.id === id);
          return pattern ? t("pattern", { name: pattern.name, questions: pattern.totalQuestions }) : id;
        },
        true,
      );
      break;
    case "taxonomy_nodes":
      editor = (
        <ScopePicker
          examCode={examCode}
          value={(value as string[]) ?? []}
          onChange={onChange}
          options={field.options ?? []}
        />
      );
      break;
    case "sections":
      editor = <SectionsEditor value={(value as PaperSection[]) ?? []} onChange={onChange} />;
      break;
    case "difficulty_mix":
      editor = <MixEditor value={(value as typeof MIX) ?? MIX} onChange={onChange} />;
      break;
    case "languages":
    case "set_codes": {
      const options = field.key === "languages" ? LANGUAGES : (["A", "B", "C", "D"] as const);
      const chosen = new Set((value as string[]) ?? []);
      editor = (
        <div className="flex flex-wrap gap-4">
          {options.map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={chosen.has(option)}
                onCheckedChange={(on) =>
                  onChange(on ? [...chosen, option] : [...chosen].filter((item) => item !== option))
                }
              />
              {field.key === "languages" ? labels.language(option) : t("set", { code: option })}
            </label>
          ))}
        </div>
      );
      break;
    }
    case "layout":
      editor = choice(LAYOUTS, labels.layout);
      break;
    case "sourcing":
      editor = choice(SOURCINGS, labels.sourcing);
      break;
    case "depth":
      editor = choice(DEPTHS, labels.depth);
      break;
    case "duration":
      editor = (
        <Input
          type="number"
          min={5}
          step={5}
          placeholder={t("noLimit")}
          value={typeof value === "number" ? value : ""}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
          className="w-32"
        />
      );
      break;
    case "include_examples":
    case "include_practice":
      editor = <Switch checked={value === true} onCheckedChange={onChange} />;
      break;
    default:
      editor = (
        <Input
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
  }
  return (
    <div className="space-y-2">
      {label}
      {editor}
    </div>
  );
}

function SectionsEditor({
  value,
  onChange,
}: {
  value: PaperSection[];
  onChange: (value: PaperSection[]) => void;
}) {
  const t = useTranslations("chat.card");
  const labels = useLabels();
  const update = (index: number, change: Partial<PaperSection>) =>
    onChange(value.map((section, n) => (n === index ? { ...section, ...change } : section)));
  const add = () =>
    onChange([
      ...value,
      {
        name: { en: labels.qtype("mcq_single") },
        qtype: "mcq_single",
        count: 10,
        marksEach: 1,
        negativeMarks: 0,
        attemptAny: null,
        difficultyMix: value[0]?.difficultyMix ?? MIX,
        scope: [],
      },
    ]);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_5rem_5rem_5rem_2rem] gap-2 text-xs text-muted-foreground">
        <span>{t("type")}</span>
        <span>{t("count")}</span>
        <span>{t("marksEach")}</span>
        <span>{t("negative")}</span>
      </div>
      {value.map((section, n) => (
        <div key={n} className="grid grid-cols-[1fr_5rem_5rem_5rem_2rem] items-center gap-2">
          <Select
            value={section.qtype}
            onValueChange={(qtype) =>
              update(n, { qtype: qtype as PaperSection["qtype"], name: { en: labels.qtype(qtype) } })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QUESTION_TYPES.map((qtype) => (
                <SelectItem key={qtype} value={qtype}>
                  {labels.qtype(qtype)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="number"
            min={1}
            value={section.count}
            onChange={(e) => update(n, { count: Number(e.target.value) })}
          />
          <Input
            type="number"
            min={0.5}
            step={0.5}
            value={section.marksEach}
            onChange={(e) => update(n, { marksEach: Number(e.target.value) })}
          />
          <Input
            type="number"
            min={0}
            step={0.25}
            value={section.negativeMarks}
            onChange={(e) => update(n, { negativeMarks: Number(e.target.value) })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("removeSection")}
            onClick={() => onChange(value.filter((_, i) => i !== n))}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add}>
        <Plus />
        {t("addSection")}
      </Button>
    </div>
  );
}

function MixEditor({ value, onChange }: { value: typeof MIX; onChange: (value: typeof MIX) => void }) {
  const t = useTranslations("chat.card");
  const levels = ["easy", "medium", "hard"] as const;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {levels.map((preset) => (
          <Button
            key={preset}
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onChange({ ...PRESETS[preset] })}
          >
            {t(`preset.${preset}`)}
          </Button>
        ))}
      </div>
      <div className="flex gap-3">
        {levels.map((level) => (
          <label key={level} className="flex items-center gap-1.5 text-sm">
            {t(`level.${level}`)}
            <Input
              type="number"
              min={0}
              max={100}
              className="w-20"
              value={Math.round(value[level] * 100)}
              onChange={(e) => onChange({ ...value, [level]: Number(e.target.value) / 100 })}
            />
            %
          </label>
        ))}
      </div>
    </div>
  );
}
