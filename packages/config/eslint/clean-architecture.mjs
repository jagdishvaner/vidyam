import boundaries from "eslint-plugin-boundaries";
import { defineConfig } from "eslint/config";

/**
 * Clean (hexagonal) architecture layers, by folder name:
 *
 *   domain          entities, value objects, domain services, repository ports. Pure: no framework, no SDK.
 *   application     use cases. Depends on domain and on port interfaces only.
 *   infrastructure  adapters that implement ports (database, queues, storage, HTTP clients).
 *   interface       controllers, SSE/queue consumers, DTO mapping. Calls use cases.
 *
 * Files outside these folders (e.g. a NestJS `*.module.ts` at a module root) are the composition root
 * and may wire anything together.
 */
export default defineConfig([
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: { boundaries },
    settings: {
      "import/resolver": { typescript: { alwaysTryTypes: true } },
      "boundaries/elements": [
        { type: "domain", pattern: "**/domain" },
        { type: "application", pattern: "**/application" },
        { type: "infrastructure", pattern: "**/infrastructure" },
        { type: "interface", pattern: "**/interface" },
      ],
    },
    rules: {
      "boundaries/dependencies": [
        "error",
        {
          default: "allow",
          // Also evaluate imports of npm packages, so the domain-purity policy below applies to them.
          checkAllOrigins: true,
          policies: [
            {
              from: { element: { type: "domain" } },
              disallow: {
                to: { element: { types: { anyOf: ["application", "infrastructure", "interface"] } } },
              },
              message: "domain must not depend on application, infrastructure or interface code",
            },
            {
              from: { element: { type: "domain" } },
              disallow: { to: { module: { origin: "external" } } },
              message: "domain must stay pure: no frameworks, ORMs or SDKs",
            },
            {
              from: { element: { type: "application" } },
              disallow: { to: { element: { types: { anyOf: ["infrastructure", "interface"] } } } },
              message: "application depends on domain and ports only; inject adapters instead",
            },
            {
              from: { element: { type: "infrastructure" } },
              disallow: { to: { element: { type: "interface" } } },
              message: "infrastructure must not depend on interface code",
            },
            {
              from: { element: { type: "interface" } },
              disallow: { to: { element: { type: "infrastructure" } } },
              message: "interface calls use cases; wire adapters in the module's composition root",
            },
          ],
        },
      ],
    },
  },
]);
