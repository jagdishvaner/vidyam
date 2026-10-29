"use client";

import type { ChatBlock } from "@vidyam/contracts";
import { Alert, AlertDescription } from "@vidyam/ui/components/alert";
import { Badge } from "@vidyam/ui/components/badge";
import { AlertTriangle, BookOpen, FileText, Info, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { ClarificationCard } from "./clarification-card";
import { Markdown } from "./markdown";
import { SpecReview } from "./spec-review";
import type { ChatInput } from "./conversation";

type Block<T extends ChatBlock["type"]> = Extract<ChatBlock, { type: T }>;

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
          <Info />
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
      return <EditSummary block={block} />;
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

function Progress({ block }: { block: Block<"progress"> }) {
  const share = block.total ? Math.round((block.done / block.total) * 100) : 0;
  return (
    <div className="space-y-1 text-sm">
      <div className="flex justify-between text-muted-foreground">
        <span>{block.stage}</span>
        <span className="tabular-nums">
          {block.done} / {block.total}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary transition-all" style={{ width: `${share}%` }} />
      </div>
    </div>
  );
}

function DocumentRef({ block }: { block: Block<"document_ref"> }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border p-3 text-sm">
      <FileText className="size-4" />
      <span className="font-medium">{block.title}</span>
      <Badge variant="secondary" className="ml-auto">
        v{block.version}
      </Badge>
    </div>
  );
}

function EditSummary({ block }: { block: Block<"edit_summary"> }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border p-3 text-sm">
      <Undo2 className="mt-0.5 size-4" />
      <span>{block.summary}</span>
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
