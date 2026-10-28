import createIntlProxy from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";

import { routing } from "./i18n/routing";

const SESSION_COOKIES = ["better-auth.session_token", "__Secure-better-auth.session_token"];

/**
 * Locale negotiation plus an optimistic sign-in redirect, shared by the web app and the admin app. This only
 * checks that a session cookie exists; real authorization always happens in the API (Next.js docs: proxy is not
 * a security boundary). Each app re-exports it from its own src/proxy.ts with its own static `config`.
 */
export function createProxy({ publicPaths = ["/login"] }: { publicPaths?: string[] } = {}) {
  const intl = createIntlProxy(routing);
  return function proxy(request: NextRequest) {
    const [, first, ...rest] = request.nextUrl.pathname.split("/");
    const locale = routing.locales.find((l) => l === first);
    if (locale) {
      const path = `/${rest.join("/")}`;
      const isPublic = publicPaths.some((p) => path === p || path.startsWith(`${p}/`));
      const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
      if (!isPublic && !hasSession) {
        const login = new URL(`/${locale}/login`, request.url);
        login.searchParams.set("next", request.nextUrl.pathname);
        return NextResponse.redirect(login);
      }
    }
    return intl(request);
  };
}
