import { createProxy } from "@vidyam/app-shell/proxy";

export default createProxy();

export const config = {
  // Everything except the API (served by NestJS behind the same origin), Next internals and static files.
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
