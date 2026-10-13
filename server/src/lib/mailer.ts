import nodemailer from 'nodemailer';
import type { Config } from '../config.ts';

export type Mail = { to: string; subject: string; text: string };

/** Sends one email; throws if it could not be handed to the mail server. */
export type Mailer = { send(mail: Mail): Promise<void> };

/** Sends through the configured SMTP server (a test inbox such as Mailtrap or Mailpit locally). */
export function createSmtpMailer(
  config: Pick<Config, 'SMTP_HOST' | 'SMTP_PORT' | 'SMTP_USER' | 'SMTP_PASS' | 'SMTP_FROM'>,
): Mailer {
  const transport = config.SMTP_HOST
    ? nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
      })
    : null;

  return {
    async send(mail) {
      if (!transport) throw new Error('Email is not configured: set SMTP_HOST in the environment');
      await transport.sendMail({ from: config.SMTP_FROM, ...mail });
    },
  };
}
