import type { Metadata } from "next";

import { ChatPage } from "@/features/chat/chat-page";

export const metadata: Metadata = { title: "Chat" };

/** /chat for a new chat, /chat/<id> for one in the history. */
export default async function Chat({ params }: PageProps<"/[locale]/chat/[[...id]]">) {
  const { id } = await params;
  return <ChatPage sessionId={id?.[0] ?? null} />;
}
