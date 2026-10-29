import { Skeleton } from "@vidyam/ui/components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { ChatPage } from "@/features/chat/chat-page";

export const metadata: Metadata = { title: "Chat" };

async function Chat({ params }: { params: Promise<{ id?: string[] }> }) {
  const { id } = await params;
  return <ChatPage sessionId={id?.[0] ?? null} />;
}

/** /chat for a new chat, /chat/<id> for one in the history. */
export default function ChatRoute({ params }: PageProps<"/[locale]/chat/[[...id]]">) {
  return (
    <Suspense fallback={<Skeleton className="h-full w-full" />}>
      <Chat params={params} />
    </Suspense>
  );
}
