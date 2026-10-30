import { Skeleton } from "@vidyam/ui/components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { AdminSections } from "@/features/dashboard/admin-sections";
import { SummaryCards } from "@/features/dashboard/summary-cards";
import { MyUsageCard, QuickActions, RecentWork } from "@/features/dashboard/teacher";
import { Welcome } from "@/features/dashboard/welcome";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * The dashboard (plan v3 §2): for everyone, quick ways to start, recent chats and documents, and their own AI
 * use; for admins, the center's spend, content coverage, backlogs and system health as well.
 */
export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="space-y-4">
        <Suspense
          fallback={
            <div className="space-y-2">
              <Skeleton className="h-8 w-72" />
              <Skeleton className="h-5 w-96" />
            </div>
          }
        >
          <Welcome />
        </Suspense>
        <QuickActions />
      </div>
      {/* Relative times ("10 hours ago") are read on each visit, not when the page is prerendered. */}
      <Suspense fallback={<Skeleton className="h-48 w-full" />}>
        <RecentWork />
      </Suspense>
      <div className="grid gap-4 lg:grid-cols-4">
        <MyUsageCard />
        <div className="lg:col-span-3">
          <SummaryCards />
        </div>
      </div>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <AdminSections />
      </Suspense>
    </div>
  );
}
