"use client";

import type { Answer, CanvasQuestion, QuestionContent, QuestionType } from "@vidyam/contracts";
import { Button } from "@vidyam/ui/components/button";
import { Checkbox } from "@vidyam/ui/components/checkbox";
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
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

const OPTION_TYPES = new Set<QuestionType>([
  "mcq_single",
  "mcq_multi",
  "assertion_reason",
  "match_columns",
  "statement",
  "passage",
]);
const NUMERIC_TYPES = new Set<QuestionType>(["numerical", "integer"]);
const KEYS = ["A", "B", "C", "D"];

interface Version {
  stem: string;
  options: string[];
  solution: string;
}

function opening(question: CanvasQuestion | null, language: "hi" | "en"): Version {
  const version = question?.content[language];
  return {
    stem: version?.stem ?? "",
    options: KEYS.map((key) => version?.options.find((o) => o.key === key)?.text ?? ""),
    solution: version?.solution ?? "",
  };
}

export const textareaClass =
  "min-h-20 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

/**
 * A teacher's own wording of a question (or a question for a slot the material couldn't fill). Saving keeps the
 * earlier question in the bank and in the paper's history; this one is saved as a new question.
 */
export function QuestionEditor({
  qtype,
  question,
  languages,
  saving,
  onSave,
  onClose,
}: {
  qtype: QuestionType;
  question: CanvasQuestion | null;
  languages: ("hi" | "en")[];
  saving: boolean;
  onSave: (content: QuestionContent, answer: Answer) => void;
  onClose: () => void;
}) {
  const t = useTranslations("canvas.editor");
  const options = OPTION_TYPES.has(qtype);
  const numeric = NUMERIC_TYPES.has(qtype);
  const [versions, setVersions] = useState(() => ({
    hi: opening(question, "hi"),
    en: opening(question, "en"),
  }));
  const [keys, setKeys] = useState<string[]>(question?.answer.kind === "options" ? question.answer.keys : []);
  const [value, setValue] = useState(
    question?.answer.kind === "numeric" ? String(question.answer.value) : "",
  );
  const [modelAnswer, setModelAnswer] = useState(
    question?.answer.kind === "text" ? question.answer.modelAnswer : "",
  );
  const shown = languages.length ? languages : (["hi"] as const);
  const written = shown.filter((lang) => versions[lang].stem.trim());
  const answered = options
    ? keys.length > 0
    : numeric
      ? value.trim() !== "" && !Number.isNaN(Number(value))
      : true;

  function change(lang: "hi" | "en", update: Partial<Version>) {
    setVersions((current) => ({ ...current, [lang]: { ...current[lang], ...update } }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content: QuestionContent = { hi: null, en: null };
    for (const lang of written) {
      const version = versions[lang];
      content[lang] = {
        stem: version.stem.trim(),
        options: options
          ? KEYS.flatMap((key, n) =>
              version.options[n]!.trim() ? [{ key, text: version.options[n]!.trim() }] : [],
            )
          : [],
        solution: version.solution.trim() || null,
      };
    }
    const answer: Answer = options
      ? { kind: "options", keys }
      : numeric
        ? {
            kind: "numeric",
            value: Number(value),
            tolerance: qtype === "integer" ? 0 : Math.abs(Number(value)) * 0.01,
          }
        : { kind: "text", modelAnswer: modelAnswer.trim() };
    onSave(content, answer);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{question ? t("title") : t("newTitle")}</DialogTitle>
          <DialogDescription>{t("hint")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-6">
          {shown.map((lang) => (
            <fieldset key={lang} className="space-y-3">
              <legend className="mb-2 text-sm font-medium">{t(lang === "hi" ? "hindi" : "english")}</legend>
              <div className="space-y-1.5">
                <Label htmlFor={`stem-${lang}`}>{t("stem")}</Label>
                <textarea
                  id={`stem-${lang}`}
                  lang={lang}
                  className={textareaClass}
                  value={versions[lang].stem}
                  onChange={(e) => change(lang, { stem: e.target.value })}
                />
              </div>
              {options && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {KEYS.map((key, n) => (
                    <div key={key} className="flex items-center gap-2">
                      <Label htmlFor={`option-${lang}-${key}`} className="w-5 shrink-0">
                        {key}
                      </Label>
                      <Input
                        id={`option-${lang}-${key}`}
                        lang={lang}
                        aria-label={t("option", { key })}
                        value={versions[lang].options[n]}
                        onChange={(e) =>
                          change(lang, {
                            options: versions[lang].options.map((text, i) =>
                              i === n ? e.target.value : text,
                            ),
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor={`solution-${lang}`}>{t("solution")}</Label>
                <textarea
                  id={`solution-${lang}`}
                  lang={lang}
                  className={textareaClass}
                  value={versions[lang].solution}
                  onChange={(e) => change(lang, { solution: e.target.value })}
                />
              </div>
            </fieldset>
          ))}
          {options && (
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">{t("correct")}</legend>
              <div className="flex gap-4">
                {KEYS.map((key) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={keys.includes(key)}
                      onCheckedChange={(on) =>
                        setKeys(
                          qtype === "mcq_multi"
                            ? on
                              ? [...keys, key].sort()
                              : keys.filter((k) => k !== key)
                            : on
                              ? [key]
                              : [],
                        )
                      }
                    />
                    {key}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {numeric && (
            <div className="space-y-1.5">
              <Label htmlFor="value">{t("value")}</Label>
              <Input
                id="value"
                inputMode="decimal"
                className="w-40"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
          )}
          {!options && !numeric && (
            <div className="space-y-1.5">
              <Label htmlFor="model-answer">{t("modelAnswer")}</Label>
              <textarea
                id="model-answer"
                className={textareaClass}
                value={modelAnswer}
                onChange={(e) => setModelAnswer(e.target.value)}
              />
            </div>
          )}
          {!written.length && <p className="text-sm text-muted-foreground">{t("noText")}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={saving || !written.length || !answered}>
              {t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
