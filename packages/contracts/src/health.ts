import { z } from "zod";

import { contract } from "./registry.js";

export const DependencyStatus = contract(
  "DependencyStatus",
  z.object({
    name: z.string(),
    ok: z.boolean(),
    latencyMs: z.number().int().nonnegative(),
    detail: z.string().nullable(),
  }),
);
export type DependencyStatus = z.infer<typeof DependencyStatus>;

export const ServiceHealth = contract(
  "ServiceHealth",
  z.object({
    service: z.enum(["api", "ai", "render"]),
    version: z.string(),
    ok: z.boolean(),
    dependencies: z.array(DependencyStatus),
  }),
  "Health of one service and each dependency it checked.",
);
export type ServiceHealth = z.infer<typeof ServiceHealth>;

export const SystemStatus = contract(
  "SystemStatus",
  z.object({ ok: z.boolean(), services: z.array(ServiceHealth) }),
  "Health of every service (API and AI engine), shown on the admin dashboard.",
);
export type SystemStatus = z.infer<typeof SystemStatus>;

export const Liveness = contract("Liveness", z.object({ ok: z.boolean() }));
export type Liveness = z.infer<typeof Liveness>;
