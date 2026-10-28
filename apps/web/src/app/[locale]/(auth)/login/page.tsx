import { Skeleton } from "@vidyam/ui/components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { LoginForm } from "@vidyam/app-shell/login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    // The form reads ?next= from the URL, which is request data: it streams in after the static shell.
    <Suspense fallback={<Skeleton className="h-80 w-full rounded-xl" />}>
      <LoginForm />
    </Suspense>
  );
}
