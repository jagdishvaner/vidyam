"use client";

import { useTranslations } from "next-intl";

export const KINDS = ["question_paper", "worksheet", "notes", "revision_sheet"] as const;
export const QUESTION_TYPES = [
  "mcq_single",
  "mcq_multi",
  "numerical",
  "integer",
  "assertion_reason",
  "match_columns",
  "statement",
  "passage",
  "short_answer",
  "long_answer",
] as const;
export const LAYOUTS = ["hindi_then_english", "side_by_side", "single_language"] as const;
export const SOURCINGS = ["bank_first", "fresh_only", "bank_only"] as const;
export const DEPTHS = ["brief", "standard", "detailed"] as const;
export const LANGUAGES = ["hi", "en"] as const;

/** Names for the values cards and the review card show, in the page's language. */
export function useLabels() {
  const t = useTranslations("chat.values");
  return {
    kind: (value: string) => t(`kind.${value}` as never),
    qtype: (value: string) => t(`qtype.${value}` as never),
    layout: (value: string) => t(`layout.${value}` as never),
    sourcing: (value: string) => t(`sourcing.${value}` as never),
    depth: (value: string) => t(`depth.${value}` as never),
    language: (value: string) => t(`language.${value}` as never),
  };
}

/** A syllabus node's or exam's name in the page's language. */
export function localName(locale: string, names: { nameEn: string; nameHi: string | null }): string {
  return locale === "hi" && names.nameHi ? names.nameHi : names.nameEn;
}
