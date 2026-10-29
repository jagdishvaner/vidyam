"use client";

import { useLocale } from "next-intl";
import { useState } from "react";

import { Conversation } from "./conversation";
import { History } from "./history";

/**
 * The chat (plan v3 §2): history on the left, the conversation on the right. A new chat gets its address once
 * its first message is sent, without reloading the page, so the answer streaming in isn't interrupted.
 */
export function ChatPage({ sessionId }: { sessionId: string | null }) {
  const locale = useLocale();
  const [created, setCreated] = useState<{ from: string | null; id: string } | null>(null);
  // A chat made on this page keeps showing until the teacher opens another one.
  const id = created && created.from === sessionId ? created.id : sessionId;
  return (
    <div className="-mx-4 -my-6 flex h-[calc(100svh-3.5rem)] md:-mx-8 md:-my-8">
      <History activeId={id} />
      <Conversation
        sessionId={id}
        onCreated={(newId) => {
          setCreated({ from: sessionId, id: newId });
          window.history.replaceState(null, "", `/${locale}/chat/${newId}`);
        }}
      />
    </div>
  );
}
