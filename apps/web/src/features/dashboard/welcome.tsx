import { getTranslations } from "next-intl/server";

import { roleKey } from "@/lib/roles";
import { getCurrentUser } from "@/lib/server/session";

export async function Welcome() {
  const [user, t] = await Promise.all([getCurrentUser(), getTranslations()]);
  return (
    <div className="space-y-1">
      <h1 className="text-2xl font-semibold tracking-tight">{t("dashboard.welcome", { name: user.name })}</h1>
      <p className="text-muted-foreground">
        {user.organization
          ? t("dashboard.roleAt", { role: t(`roles.${roleKey(user)}`), organization: user.organization.name })
          : t("dashboard.noOrganization")}
      </p>
    </div>
  );
}
