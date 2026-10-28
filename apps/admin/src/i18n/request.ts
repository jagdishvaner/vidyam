import { SHARED_MESSAGES } from "@vidyam/app-shell/i18n/messages";
import { routing } from "@vidyam/app-shell/i18n/routing";
import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { notFound } from "next/navigation";
import { locale as rootLocale } from "next/root-params";

export default getRequestConfig(async () => {
  const locale = await rootLocale();
  if (!hasLocale(routing.locales, locale)) notFound();
  const own = (await import(`../../messages/${locale}.json`)).default;
  return { locale, messages: { ...SHARED_MESSAGES[locale], ...own } };
});
