import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Static shell prerendered; per-user parts stream in behind <Suspense> (hybrid rendering).
  cacheComponents: true,
  partialPrefetching: true,
  transpilePackages: ["@vidyam/ui"],
  experimental: {
    // Dev-time instant-navigation validation fails inside Next 16.4.3 itself ("Could not find
    // PlaceValidationBoundaryBelowThisLevel in the React Client Manifest"). Validate only segments that opt in
    // with `export const instant`; Playwright e2e tests cover what users actually see.
    instantInsights: { validationLevel: "manual-warning" },
  },
};

export default withNextIntl(nextConfig);
