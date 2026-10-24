import nodemailer from "nodemailer";

import type { Env } from "../../../config/env.js";

export interface Mailer {
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

/** SMTP mail: Mailpit locally (web UI on :38181), Amazon SES SMTP on AWS. */
export function createSmtpMailer(env: Pick<Env, "VIDYAM_SMTP_URL" | "VIDYAM_MAIL_FROM">): Mailer {
  const transport = nodemailer.createTransport(env.VIDYAM_SMTP_URL);
  return {
    async send(message) {
      await transport.sendMail({ from: env.VIDYAM_MAIL_FROM, ...message });
    },
  };
}
