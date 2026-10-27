import { roleCan } from "@vidyam/contracts";
import { Skeleton } from "@vidyam/ui/components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { SourceDetail } from "@/features/library/source-detail";
import { getCurrentUser } from "@/lib/server/session";

export const metadata: Metadata = { title: "Library" };

/** The Remove button is a UI hint only; the API enforces who may remove files. */
async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, user] = await Promise.all([params, getCurrentUser()]);
  return <SourceDetail sourceId={id} canRemove={roleCan(user.orgRole, "library", "remove")} />;
}

export default function LibrarySourcePage({ params }: PageProps<"/[locale]/library/[id]">) {
  return (
    <div className="mx-auto max-w-6xl">
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
        <Detail params={params} />
      </Suspense>
    </div>
  );
}
