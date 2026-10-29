"use client";

import type { ChatBlock, ChatMessage, ChatTurnInput } from "@vidyam/contracts";
import { Alert, AlertDescription } from "@vidyam/ui/components/alert";
import { Button } from "@vidyam/ui/components/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@vidyam/ui/components/select";
import { Skeleton } from "@vidyam/ui/components/skeleton";
import { cn } from "@vidyam/ui/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowUp, Loader2, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";

import {
  chatKeys,
  createSession,
  followTurn,
  sendTurn,
  useMySettings,
  useSession,
  useUpdateSession,
} from "./api";
import { AssistantBlock, DocumentContext, UserBlocks } from "./blocks";

export type ChatInput = ChatTurnInput;

const DEFAULT_MODEL = "__default__";
const EXAMPLES = ["examplePaper", "exampleDoubt", "exampleNotes"] as const;

/** An answer on its way: what the teacher sent, and what has arrived of the reply. */
interface Streaming {
  user: ChatBlock[];
  messageId: string | null;
  text: string;
  blocks: ChatBlock[];
  error: string | null;
}

/**
 * One chat: its messages, the answer streaming in, and the box to write in (plan v3 §2, ADR 0015). A new chat
 * is created with its first message. An answer still coming when the page opens is followed from where it is.
 */
export function Conversation({
  sessionId,
  onCreated,
  onDocument,
  onOpenDocument,
}: {
  sessionId: string | null;
  onCreated: (id: string) => void;
  /** The chat's latest document, once it has one. */
  onDocument: (documentId: string | null) => void;
  onOpenDocument: (documentId: string) => void;
}) {
  const t = useTranslations("chat");
  const client = useQueryClient();
  const detail = useSession(sessionId);
  const [streaming, setStreaming] = useState<Streaming | null>(null);
  const [newChatModel, setNewChatModel] = useState<string | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const followed = useRef<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const shown = useRef<string | null>(sessionId);

  // Another chat was opened: stop following this one's answer (it goes on without us).
  useEffect(() => {
    if (shown.current !== null && shown.current !== sessionId) {
      stop.current?.();
      setStreaming(null);
    }
    shown.current = sessionId;
  }, [sessionId]);
  useEffect(() => () => stop.current?.(), []);

  function follow(id: string, turnId: string, user: ChatBlock[]) {
    followed.current = turnId;
    setStreaming({ user, messageId: null, text: "", blocks: [], error: null });
    stop.current = followTurn(
      turnId,
      (event) =>
        setStreaming((current) => {
          if (!current) return current;
          switch (event.event) {
            case "turn_started":
              return { ...current, messageId: event.messageId };
            case "text_delta":
              return { ...current, text: current.text + event.text };
            case "block":
              return { ...current, blocks: [...current.blocks, event.block] };
            case "error":
              return { ...current, error: event.message };
            default:
              return current;
          }
        }),
      () => {
        void client.invalidateQueries({ queryKey: chatKeys.sessions });
        // The chat may have changed its document: the canvas shows the newest version.
        void client.invalidateQueries({ queryKey: ["document"] });
        void client.refetchQueries({ queryKey: chatKeys.session(id) }).then(() => setStreaming(null));
      },
    );
  }

  const documentId = detail.data?.session.documentId ?? null;
  useEffect(() => onDocument(documentId), [documentId, onDocument]);

  // Opening a chat whose answer is still coming: follow it.
  const active = detail.data?.activeTurnId ?? null;
  useEffect(() => {
    if (sessionId && active && !streaming && followed.current !== active) follow(sessionId, active, []);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follow once per active turn
  }, [sessionId, active]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [detail.data?.messages.length, streaming?.text, streaming?.blocks.length]);

  async function send(input: ChatInput) {
    if (streaming) return;
    const user: ChatBlock[] =
      input.kind === "text"
        ? [{ type: "text", text: input.text }]
        : input.kind === "card_submit"
          ? [
              {
                type: "card_response",
                cardId: input.cardId,
                values: input.values,
                summary: t("cardAnswered"),
              },
            ]
          : [
              {
                type: "action",
                action: input.action,
                targetId: input.targetId ?? null,
                summary: t(`actions.${input.action}`),
              },
            ];
    setStreaming({ user, messageId: null, text: "", blocks: [], error: null });
    try {
      let id = sessionId;
      if (!id) {
        id = (await createSession(newChatModel)).id;
        onCreated(id);
      }
      const accepted = await sendTurn(id, input, null);
      follow(id, accepted.turnId, user);
    } catch (error) {
      setStreaming(null);
      toast.error(error instanceof Error ? error.message : t("failed"));
    }
  }

  const messages = detail.data?.messages ?? [];
  const lastAssistant = streaming ? null : [...messages].reverse()[0];
  const loading = sessionId !== null && detail.isPending;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <h2 className="truncate text-sm font-medium">
          {detail.data?.session.title || (sessionId ? t("untitled") : t("newChat"))}
        </h2>
        <ModelPicker
          sessionId={sessionId}
          sessionModel={detail.data?.session.modelId ?? null}
          newChatModel={newChatModel}
          onNewChatModel={setNewChatModel}
        />
      </header>
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : messages.length === 0 && !streaming ? (
            <Welcome send={send} />
          ) : (
            <DocumentContext.Provider
              value={{ generation: detail.data?.generation ?? null, open: onOpenDocument }}
            >
              {messages.map((message) => (
                <Message
                  key={message.id}
                  message={message}
                  live={message.id === lastAssistant?.id}
                  send={send}
                />
              ))}
            </DocumentContext.Provider>
          )}
          {streaming && <StreamingMessage streaming={streaming} />}
          <div ref={end} />
        </div>
      </div>
      <Composer busy={streaming !== null} send={(text) => send({ kind: "text", text })} />
    </div>
  );
}

function Message({
  message,
  live,
  send,
}: {
  message: ChatMessage;
  live: boolean;
  send: (input: ChatInput) => void;
}) {
  if (message.role === "user") {
    return (
      <div className="ml-auto max-w-[85%] rounded-2xl bg-primary px-4 py-2.5 text-primary-foreground">
        <UserBlocks blocks={message.blocks} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {message.blocks.map((block, n) => (
        <AssistantBlock key={n} block={block} live={live && message.role === "assistant"} send={send} />
      ))}
    </div>
  );
}

function StreamingMessage({ streaming }: { streaming: Streaming }) {
  const t = useTranslations("chat");
  return (
    <>
      {streaming.user.length > 0 && (
        <div className="ml-auto max-w-[85%] rounded-2xl bg-primary px-4 py-2.5 text-primary-foreground">
          <UserBlocks blocks={streaming.user} />
        </div>
      )}
      <div className="flex flex-col gap-3">
        {streaming.text ? (
          <AssistantBlock
            block={{ type: "text", text: streaming.text }}
            live={false}
            send={() => undefined}
          />
        ) : (
          !streaming.error && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t("thinking")}
            </p>
          )
        )}
        {streaming.blocks.map((block, n) => (
          <AssistantBlock key={n} block={block} live={false} send={() => undefined} />
        ))}
        {streaming.error && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertDescription>{streaming.error}</AlertDescription>
          </Alert>
        )}
      </div>
    </>
  );
}

function Welcome({ send }: { send: (input: ChatInput) => void }) {
  const t = useTranslations("chat");
  return (
    <div className="flex flex-col items-center gap-6 py-12 text-center">
      <Sparkles className="size-10 text-muted-foreground" />
      <div className="space-y-1">
        <p className="text-xl font-semibold">{t("welcome")}</p>
        <p className="text-muted-foreground">{t("welcomeHint")}</p>
      </div>
      <div className="grid w-full gap-2 sm:grid-cols-3">
        {EXAMPLES.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => send({ kind: "text", text: t(key) })}
            className="rounded-lg border p-3 text-left text-sm hover:bg-muted"
          >
            {t(key)}
          </button>
        ))}
      </div>
    </div>
  );
}

function Composer({ busy, send }: { busy: boolean; send: (text: string) => void }) {
  const t = useTranslations("chat");
  const [text, setText] = useState("");
  const submit = () => {
    const message = text.trim();
    if (!message || busy) return;
    send(message);
    setText("");
  };
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit();
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }
  return (
    <form onSubmit={onSubmit} className="shrink-0 border-t p-3">
      <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border bg-background p-2 focus-within:ring-2 focus-within:ring-ring/40">
        <textarea
          aria-label={t("message")}
          rows={1}
          maxLength={8000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("placeholder")}
          className="max-h-48 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none field-sizing-content"
        />
        <Button type="submit" size="icon" disabled={busy || !text.trim()} aria-label={t("send")}>
          {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
        </Button>
      </div>
      <p className={cn("mx-auto mt-1.5 max-w-3xl text-center text-xs text-muted-foreground")}>
        {t("disclaimer")}
      </p>
    </form>
  );
}

/** The models the center lets teachers pick (Admin → AI models); the chat remembers its choice. */
function ModelPicker({
  sessionId,
  sessionModel,
  newChatModel,
  onNewChatModel,
}: {
  sessionId: string | null;
  sessionModel: string | null;
  newChatModel: string | null;
  onNewChatModel: (model: string | null) => void;
}) {
  const t = useTranslations("chat");
  const settings = useMySettings();
  const update = useUpdateSession();
  const models = settings.data?.models ?? [];
  if (models.length === 0) return null;
  const value = (sessionId ? sessionModel : newChatModel) ?? DEFAULT_MODEL;
  return (
    <div className="ml-auto">
      <Select
        value={value}
        onValueChange={(choice) => {
          const modelId = choice === DEFAULT_MODEL ? null : choice;
          if (sessionId) {
            update.mutate(
              { id: sessionId, update: { modelId } },
              { onError: (error) => toast.error(error.message) },
            );
          } else {
            onNewChatModel(modelId);
          }
        }}
      >
        <SelectTrigger size="sm" aria-label={t("model")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          <SelectItem value={DEFAULT_MODEL}>{t("defaultModel")}</SelectItem>
          {models.map((model) => (
            <SelectItem key={model.id} value={model.id}>
              {model.displayName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
