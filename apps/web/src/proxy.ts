import createIntlProxy from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";

import { routing } from "./i18n/routing";

const intl = createIntlProxy(routing);

/** Pages reachable without a session (prefix match after the locale segment). */
const PUBLIC_PATHS = ["/login"];
const SESSION_COOKIES = ["better-auth.session_token", "__Secure-better-auth.session_token"];

/**
 * Locale negotiation plus an optimistic sign-in redirect. This only checks that a session cookie exists;
 * real authorization always happens in the API (Next.js docs: proxy is not a security boundary).
 */
export default function proxy(request: NextRequest) {
  const [, first, ...rest] = request.nextUrl.pathname.split("/");
  const locale = routing.locales.find((l) => l === first);
  if (locale) {
    const path = `/${rest.join("/")}`;
    const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
    const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
    if (!isPublic && !hasSession) {
      const login = new URL(`/${locale}/login`, request.url);
      login.searchParams.set("next", request.nextUrl.pathname);
      return NextResponse.redirect(login);
    }
  }
  return intl(request);
}

export const config = {
  // Everything except the API (served by NestJS behind the same origin), Next internals and static files.
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
