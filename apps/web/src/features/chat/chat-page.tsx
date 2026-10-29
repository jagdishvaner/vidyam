"use client";

import { useLocale } from "next-intl";
import { useCallback, useRef, useState } from "react";

import { Canvas } from "@/features/canvas/canvas";

import { Conversation } from "./conversation";
import { History } from "./history";

/**
 * The chat (plan v3 §2): history on the left, the conversation, and the canvas with the chat's document on the
 * right. A new chat gets its address once its first message is sent, without reloading the page, so the answer
 * streaming in isn't interrupted. A chat's document opens on the canvas by itself, once per chat.
 */
export function ChatPage({ sessionId }: { sessionId: string | null }) {
  const locale = useLocale();
  const [created, setCreated] = useState<{ from: string | null; id: string } | null>(null);
  // A chat made on this page keeps showing until the teacher opens another one.
  const id = created && created.from === sessionId ? created.id : sessionId;
  // The canvas belongs to the chat it was opened in: another chat shows its own document instead.
  const [canvas, setCanvas] = useState<{ chat: string | null; documentId: string } | null>(null);
  const shown = useRef(new Set<string>());
  const open = useCallback((documentId: string) => setCanvas({ chat: id, documentId }), [id]);
  const onDocument = useCallback(
    (documentId: string | null) => {
      if (documentId && !shown.current.has(documentId)) {
        shown.current.add(documentId);
        setCanvas({ chat: id, documentId });
      }
    },
    [id],
  );
  const documentId = canvas?.chat === id ? canvas.documentId : null;
  return (
    <div className="-mx-4 -my-6 flex h-[calc(100svh-3.5rem)] md:-mx-8 md:-my-8">
      <History activeId={id} />
      <Conversation
        sessionId={id}
        onCreated={(newId) => {
          setCreated({ from: sessionId, id: newId });
          window.history.replaceState(null, "", `/${locale}/chat/${newId}`);
        }}
        onDocument={onDocument}
        onOpenDocument={open}
      />
      {documentId && <Canvas key={documentId} documentId={documentId} onClose={() => setCanvas(null)} />}
    </div>
  );
}
