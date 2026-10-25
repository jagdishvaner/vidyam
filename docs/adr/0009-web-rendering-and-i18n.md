# 0009. Web rendering: static shells with streamed per-user data; locale in the URL

- Status: Accepted
- Date: 2026-10-25

## Context

The web app should feel instant (the user asked for a "fully hybrid and rich" frontend), but almost every screen
shows per-user, per-organization data. The UI is bilingual (English and Hindi).

## Decision

- **Next.js 16 with Cache Components and Partial Prefetching.**
  - Layouts, navigation and headings prerender into a static shell.
  - Anything that reads the session or the URL streams in behind `<Suspense>`.
  - The production build fails if a page would block (verified: the login, forgot-password and reset pages are
    fully static; the dashboard, members and invite pages are partially prerendered).
- **Current user through a Data Access Layer** (`getCurrentUser`), cached with `use cache: private`:
  per browser, never on the server, for 30–60 s.
- **The locale is the first path segment** (`/en/...`, `/hi/...`) through next-intl and `next/root-params`, so
  each language gets its own static shell. A locale cookie would have made every page dynamic.
- **`proxy.ts` only negotiates the locale and does an optimistic sign-in redirect.** Authorization always
  happens in the API.
- **Fonts:** Noto Sans + Noto Sans Devanagari, so mixed Hindi and English text renders with matching weights.
- **Next 16.4.3's dev-time "instant navigation" validation fails inside Next itself**, so it runs only for
  segments that opt in. The production build check and Playwright e2e tests cover the same ground.

## Consequences

- Shells load instantly from cache; user data appears as soon as the API answers.
- Every component that reads cookies, headers or the URL must sit inside a Suspense boundary. The build enforces
  this.
- Hindi and English URLs are distinct and shareable.
