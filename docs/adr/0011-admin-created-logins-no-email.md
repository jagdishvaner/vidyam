# 0011. Center admins create logins; no email

- Status: Accepted. Supersedes the "Mail" line of [0006](0006-auth-better-auth.md) and the Mailpit entry of
  [0007](0007-local-environment-and-toolchain.md).
- Date: 2026-10-25

## Context

Invitations and password-reset links were emailed, so local development ran a mail catcher (Mailpit). The owner
doesn't want a mail server in the stack. A coaching center's staff are few and known in person, and a login is
easy to pass on directly, for example on WhatsApp.

## Decision

- **No email anywhere.** Mailpit, the SMTP settings and Nodemailer are removed. AWS needs no SES either.
- **Public sign-up is off.** A center admin creates each login on the Members page: name, email (the login ID),
  role and password. The password is shown once so the admin can pass it on.
- **Forgotten password:** the center admin sets a new one, and the member is signed out on every device.
- **Someone leaves:** the admin removes them. Their sessions end at once, and a login that belongs to no other
  center is deleted.
- **Limits:**
  - Center admins act only inside their own center.
  - Only a platform admin can change or remove a platform admin's login.
  - Admins can't remove themselves, so every center keeps an admin.
- **Local demo logins** for every role come from `pnpm db:seed` (`VIDYAM_SEED_DEMO_PASSWORD`).

## Consequences

- One container fewer, and no email deliverability to manage.
- The admin knows each member's first password. A "change my password" page for members can be added when
  wanted.
- If self-service reset is ever needed, email (SES) or an SMS one-time code can be added behind the same
  members module without changing the rest.
