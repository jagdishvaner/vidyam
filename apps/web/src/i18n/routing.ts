import { defineRouting } from "next-intl/routing";

/** English and Hindi UI. The locale is the first path segment (/en/..., /hi/...) so pages stay static. */
export const routing = defineRouting({
  locales: ["en", "hi"],
  defaultLocale: "en",
});

export type Locale = (typeof routing.locales)[number];
