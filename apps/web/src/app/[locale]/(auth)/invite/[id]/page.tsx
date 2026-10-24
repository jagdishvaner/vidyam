import { Skeleton } from "@vidyam/ui/components/skeleton";
import { Suspense } from "react";

import { AcceptInvite } from "@/features/auth/accept-invite";

async function Invite({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AcceptInvite invitationId={id} />;
}

export default function InvitePage({ params }: PageProps<"/[locale]/invite/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-80 w-full rounded-xl" />}>
      <Invite params={params} />
    </Suspense>
  );
}
