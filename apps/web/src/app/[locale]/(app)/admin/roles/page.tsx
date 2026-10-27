import type { Metadata } from "next";

import { RolesMatrix } from "@/features/admin/roles-matrix";

export const metadata: Metadata = { title: "Roles & permissions" };

export default function RolesPage() {
  return <RolesMatrix />;
}
