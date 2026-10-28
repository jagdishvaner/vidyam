import en from "../messages/en.json";
import hi from "../messages/hi.json";
import type { Locale } from "./routing";

/** Strings both apps use (common, roles, sign-in); each app adds its own in its i18n/request.ts. */
export const SHARED_MESSAGES: Record<Locale, typeof en> = { en, hi };
