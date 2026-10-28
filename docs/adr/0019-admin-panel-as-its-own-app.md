# 0019. The admin panel is its own app on its own subdomain

- Status: Accepted
- Date: 2026-10-28

## Context

The admin panel was built inside the teachers' web app under `/admin`. The owner wants it separate: its own app
in `apps/`, hosted on its own subdomain (`admin.<domain>`), like the teachers' app on `app.<domain>`.

A separate origin has real benefits:

- admin pages never ship in the teachers' bundle;
- the panel can get stricter edge rules on AWS (WAF, IP allow-lists);
- it deploys and scales on its own;
- in production its sign-in is separate from the app's, since cookies don't cross subdomains by default.

## Decision

- **`apps/admin`** is a Next.js 16 app with the same stack as `apps/web` (next-intl English/Hindi, TanStack
  Query, shadcn UI). It owns every admin screen (Staff, Roles, Exams & syllabus, Paper patterns, AI models,
  Prompts, Usage & budgets, Center profile, Audit log, System health). Its routes have no `/admin` prefix
  (`/en/staff`), and it opens on Staff.
- **`packages/app-shell`** holds what both apps share, compiled by each app (`transpilePackages`):
  - sign-in form, session loader, API clients, error helper;
  - locale routing, navigation and shared messages (common, roles, sign-in, system status);
  - header pieces (language, theme, user menu), the system-status card;
  - the optimistic sign-in redirect (`createProxy`).
- **Same-origin API on both sites.** Each origin passes `/api/*` to the same NestJS API (Caddy locally:
  `:38000` app, `:38001` admin; CloudFront on AWS), so neither app needs CORS. The API trusts both origins
  for sign-in (`VIDYAM_APP_URL`, `VIDYAM_ADMIN_URL`).
- **The panel is still only a UI gate.** Every admin endpoint is enforced by the API's permissions; the panel
  shows non-admins a link back to the app.
- **Links between the apps** use the origins from the environment: the app's Admin item opens the panel for
  those who can manage the center; the panel's header has "Open the app". The old `/settings/members` address
  redirects to the panel's Staff page.
- **One Dockerfile for both Next.js apps** (`infra/docker/next.Dockerfile`, `APP` and `PORT` build args); the
  compose `full` profile runs both.

## Consequences

- Two Next.js builds and images instead of one; shared code lives in one package, so the sign-in and session
  logic exist once.
- Tailwind scans both apps and the shared package for class names (`packages/ui` globals).
- Locally both apps share the session cookie (cookies ignore ports). In production the panel has its own
  sign-in unless cross-subdomain cookies are switched on later.
