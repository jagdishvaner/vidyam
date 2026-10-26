"use client";

import type { SourceState } from "@vidyam/contracts";
import { Badge } from "@vidyam/ui/components/badge";
import { useTranslations } from "next-intl";

const VARIANT = {
  queued: "outline",
  reading: "outline",
  ready: "default",
  waiting_for_ocr: "secondary",
  failed: "destructive",
} as const satisfies Record<SourceState, "default" | "secondary" | "outline" | "destructive">;

export function StateBadge({ state }: { state: SourceState }) {
  const t = useTranslations("library.states");
  return <Badge variant={VARIANT[state]}>{t(state)}</Badge>;
}
