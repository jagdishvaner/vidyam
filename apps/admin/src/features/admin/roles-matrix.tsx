import { OrgRole, PERMISSIONS, roleCan, type PermissionResource } from "@vidyam/contracts";
import { Card, CardContent } from "@vidyam/ui/components/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@vidyam/ui/components/table";
import { Check, Minus } from "lucide-react";
import { useTranslations } from "next-intl";

const ROLES = OrgRole.options;

/** The fixed roles, read from the same matrix the API enforces (@vidyam/contracts). */
export function RolesMatrix() {
  const t = useTranslations();
  const rows = (Object.entries(PERMISSIONS) as [PermissionResource, readonly string[]][]).flatMap(
    ([resource, actions]) => actions.map((action) => ({ resource, action, key: `${resource}.${action}` })),
  );
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("permissions.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("permissions.subtitle")}</p>
      </div>
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("permissions.action")}</TableHead>
                {ROLES.map((role) => (
                  <TableHead key={role} className="text-center">
                    {t(`roles.${role}`)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ resource, action, key }) => (
                <TableRow key={key}>
                  <TableCell className="whitespace-normal">
                    {t(`permissions.can.${key}` as "permissions.can.chat.use")}
                  </TableCell>
                  {ROLES.map((role) =>
                    roleCan(role, resource, action as never) ? (
                      <TableCell key={role} className="text-center">
                        <Check
                          className="mx-auto size-4 text-primary"
                          aria-label={t("permissions.allowed")}
                        />
                      </TableCell>
                    ) : (
                      <TableCell key={role} className="text-center">
                        <Minus
                          className="mx-auto size-4 text-muted-foreground/50"
                          aria-label={t("permissions.notAllowed")}
                        />
                      </TableCell>
                    ),
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
