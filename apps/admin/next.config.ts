import path from "node:path";

import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Static shell prerendered; per-user parts stream in behind <Suspense> (hybrid rendering).
  cacheComponents: true,
  partialPrefetching: true,
  transpilePackages: ["@vidyam/ui", "@vidyam/app-shell"],
  // Loaded by Node itself, not bundled: the OpenTelemetry SDK patches modules as Node loads them.
  serverExternalPackages: ["@vidyam/telemetry"],
  // Container image: a minimal server.js with only the files it needs. Trace from the monorepo root so the
  // workspace packages (@vidyam/ui, app-shell, api-client, contracts) are included. Builds run with cwd = apps/admin.
  output: "standalone",
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  experimental: {
    // Dev-time instant-navigation validation fails inside Next 16.4.3 itself ("Could not find
    // PlaceValidationBoundaryBelowThisLevel in the React Client Manifest"). Validate only segments that opt in
    // with `export const instant`; Playwright e2e tests cover what users actually see.
    instantInsights: { validationLevel: "manual-warning" },
  },
};

export default withNextIntl(nextConfig);
