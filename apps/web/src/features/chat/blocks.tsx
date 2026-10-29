"use client";

import type { ChatBlock, GenerationProgress } from "@vidyam/contracts";
import { Alert, AlertDescription } from "@vidyam/ui/components/alert";
import { Badge } from "@vidyam/ui/components/badge";
import { Button } from "@vidyam/ui/components/button";
import { AlertTriangle, BookOpen, FileText, Info, Loader2, PenLine, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { createContext, useContext } from "react";

import { ClarificationCard } from "./clarification-card";
import { Markdown } from "./markdown";
import { SpecReview } from "./spec-review";
import type { ChatInput } from "./conversation";

type Block<T extends ChatBlock["type"]> = Extract<ChatBlock, { type: T }>;

/** The chat's latest generation run (how far its document has got), and opening a document on the canvas. */
export const DocumentContext = createContext<{
  generation: GenerationProgress | null;
  open: (documentId: string) => void;
}>({ generation: null, open: () => undefined });

/**
 * One block of an assistant message (ADR 0015). Cards and the review card can only be answered while they are
 * the chat's latest word (`live`).
 */
export function AssistantBlock({
  block,
  live,
  send,
}: {
  block: ChatBlock;
  live: boolean;
  send: (input: ChatInput) => void;
}) {
  switch (block.type) {
    case "text":
      return <Markdown text={block.text} />;
    case "citations":
      return <Citations block={block} />;
    case "clarification":
      return <ClarificationCard block={block} live={live} send={send} />;
    case "spec_review":
      return <SpecReview block={block} live={live} send={send} />;
    case "notice":
      return (
        <Alert>
          {block.level === "warning" ? <AlertTriangle /> : <Info />}
          <AlertDescription>{block.text}</AlertDescription>
        </Alert>
      );
    case "error":
      return (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertDescription>{block.message}</AlertDescription>
        </Alert>
      );
    case "progress":
      return <Progress block={block} />;
    case "document_ref":
      return <DocumentRef block={block} />;
    case "edit_summary":
      return <EditSummary block={block} live={live} send={send} />;
    default:
      return null; // card answers and button presses are the teacher's side
  }
}

function Citations({ block }: { block: Block<"citations"> }) {
  const t = useTranslations("chat");
  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
      <p className="flex items-center gap-1.5 font-medium">
        <BookOpen className="size-4" />
        {t("sources")}
      </p>
      <ol className="space-y-2">
        {block.items.map((item, n) => (
          <li key={item.chunkId} className="flex gap-2">
            <span className="text-muted-foreground tabular-nums">[{n + 1}]</span>
            <div className="min-w-0">
              <p className="font-medium">
                {item.filename}
                {(item.pageLabel ?? item.pageStart) !== null && (
                  <span className="font-normal text-muted-foreground">
                    {" · "}
                    {t("page", { page: item.pageLabel ?? String(item.pageStart) })}
                  </span>
                )}
              </p>
              <p className="line-clamp-2 text-muted-foreground">{item.quote}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Bar({ label, done, total }: { label: string; done: number; total: number }) {
  const share = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="space-y-1 text-sm">
      <div className="flex justify-between text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">
          {done} / {total}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary transition-all" style={{ width: `${share}%` }} />
      </div>
    </div>
  );
}

function Progress({ block }: { block: Block<"progress"> }) {
  return <Bar label={block.stage} done={block.done} total={block.total} />;
}

/**
 * A document the chat made or is making. While its run is going, it shows how many questions (or sections)
 * are done; the finished document arrives as a newer message.
 */
function DocumentRef({ block }: { block: Block<"document_ref"> }) {
  const t = useTranslations("chat.document");
  const { generation, open } = useContext(DocumentContext);
  const run = block.version === 0 && generation?.documentId === block.documentId ? generation : null;
  const making = run && (run.status === "planning" || run.status === "running");
  return (
    <div className="space-y-3 rounded-lg border p-3 text-sm">
      <div className="flex items-center gap-2">
        {making ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
        <span className="font-medium">{block.title}</span>
        <Badge variant={run?.status === "failed" ? "destructive" : "secondary"} className="ml-auto">
          {run ? t(run.status) : t("version", { version: block.version })}
        </Badge>
        <Button variant="outline" size="sm" onClick={() => open(block.documentId)}>
          {t("open")}
        </Button>
      </div>
      {making && <Bar label={t(run.total ? "progress" : "planning")} done={run.done} total={run.total} />}
    </div>
  );
}

/** A change the chat made to its document: what, the version it made, and (while it is the latest) Undo. */
function EditSummary({
  block,
  live,
  send,
}: {
  block: Block<"edit_summary">;
  live: boolean;
  send: (input: ChatInput) => void;
}) {
  const t = useTranslations("chat.document");
  const { open } = useContext(DocumentContext);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
      <PenLine className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">{block.summary}</span>
      <Badge variant="secondary">{t("version", { version: block.toVersion })}</Badge>
      <Button variant="outline" size="sm" onClick={() => open(block.documentId)}>
        {t("open")}
      </Button>
      {live && block.ops.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          aria-label={t("undoChange")}
          onClick={() => send({ kind: "action", action: "undo", targetId: block.documentId })}
        >
          <Undo2 />
          {t("undo")}
        </Button>
      )}
    </div>
  );
}

/** What the teacher sent: words, an answered card, or a button press. */
export function UserBlocks({ blocks }: { blocks: ChatBlock[] }) {
  return (
    <>
      {blocks.map((block, n) => {
        if (block.type === "text")
          return (
            <p key={n} className="whitespace-pre-wrap">
              {block.text}
            </p>
          );
        if (block.type === "card_response" || block.type === "action") {
          return (
            <p key={n} className="text-sm italic opacity-90">
              {block.summary}
            </p>
          );
        }
        return null;
      })}
    </>
  );
}
