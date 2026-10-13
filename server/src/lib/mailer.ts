import nodemailer from 'nodemailer';
import type { Config } from '../config.ts';

export type Mail = { to: string; subject: string; text: string };

/** Sends one email; throws if it could not be handed to the mail server. */
export type Mailer = { send(mail: Mail): Promise<void> };

const NOT_FOUND = ['ENOTFOUND', 'EAI_AGAIN'];
const NOT_REACHABLE = ['ECONNREFUSED', 'ETIMEDOUT', 'ESOCKET', 'ECONNECTION'];

/**
 * Turns an SMTP failure into a sentence that names the setting to check. The message ends up on
 * the failed export, so it must make sense to the person reading that page.
 */
export function describeMailError(err: unknown, server: { host: string; port: number }) {
  const code = (err as { code?: string } | null)?.code ?? '';
  if (NOT_FOUND.includes(code)) {
    return `Could not find the mail server "${server.host}". Check SMTP_HOST.`;
  }
  if (NOT_REACHABLE.includes(code)) {
    return `Could not connect to the mail server at ${server.host}:${server.port}. Check SMTP_HOST and SMTP_PORT.`;
  }
  if (code === 'EAUTH') {
    return 'The mail server rejected the SMTP username or password. Check SMTP_USER and SMTP_PASS.';
  }
  return `Could not send the email: ${err instanceof Error ? err.message : String(err)}`;
}

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
      try {
        await transport.sendMail({ from: config.SMTP_FROM, ...mail });
      } catch (err) {
        throw new Error(
          describeMailError(err, { host: config.SMTP_HOST!, port: config.SMTP_PORT }),
          { cause: err },
        );
      }
    },
  };
}
