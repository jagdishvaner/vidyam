import { Skeleton } from "@vidyam/ui/components/skeleton";
import { Suspense } from "react";

import { ResetPasswordForm } from "@/features/auth/reset-password-form";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<Skeleton className="h-56 w-full rounded-xl" />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
