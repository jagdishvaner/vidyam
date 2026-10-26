/** The pipeline's raw progress for one file (sources.stage / status, plus counts of what it produced). */
export interface SourceProgress {
  stage: string;
  status: string;
  sections: number;
  ocrPages: number;
}

export type SourceStateName = "queued" | "reading" | "ready" | "waiting_for_ocr" | "failed";

/**
 * Collapses the pipeline's stages into what a center can act on. Must agree with the SQL filters in
 * infrastructure/drizzle-library-reader.ts.
 */
export function sourceState({ stage, status, sections, ocrPages }: SourceProgress): SourceStateName {
  if (status === "failed") return "failed";
  if (stage === "uploaded") return "queued";
  if (status === "running" || stage !== "chunked") return "reading";
  if (sections === 0 && ocrPages > 0) return "waiting_for_ocr";
  return "ready";
}

export type PageReadingStateName = "text" | "converted" | "waiting_for_ocr" | "blank";

export function pageReadingState(method: string, meta: Record<string, unknown>): PageReadingStateName {
  if (meta.awaitingOcr) return "waiting_for_ocr";
  if (meta.note === "blank page") return "blank";
  return method === "legacy_font" ? "converted" : "text";
}
