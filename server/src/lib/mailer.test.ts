import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createSmtpMailer, describeMailError } from './mailer.ts';

const where = { host: 'smtp', port: 2525 };
const failure = (code: string, message = 'low-level detail') =>
  Object.assign(new Error(message), { code });

describe('describeMailError', () => {
  it.each(['ENOTFOUND', 'EAI_AGAIN'])('says the mail server was not found (%s)', (code) => {
    expect(describeMailError(failure(code), where)).toBe(
      'Could not find the mail server "smtp". Check SMTP_HOST.',
    );
  });

  it.each(['ECONNREFUSED', 'ETIMEDOUT', 'ESOCKET', 'ECONNECTION'])(
    'says the connection failed (%s)',
    (code) => {
      expect(describeMailError(failure(code), where)).toBe(
        'Could not connect to the mail server at smtp:2525. Check SMTP_HOST and SMTP_PORT.',
      );
    },
  );

  it('says the login was rejected', () => {
    expect(describeMailError(failure('EAUTH'), where)).toBe(
      'The mail server rejected the SMTP username or password. Check SMTP_USER and SMTP_PASS.',
    );
  });

  it('keeps the original message for anything else', () => {
    expect(describeMailError(failure('EENVELOPE', 'No recipients defined'), where)).toBe(
      'Could not send the email: No recipients defined',
    );
    expect(describeMailError('boom', where)).toBe('Could not send the email: boom');
  });
});

describe('createSmtpMailer', () => {
  const mail = { to: 'hr@acme.local', subject: 's', text: 't' };
  const settings = {
    SMTP_FROM: 'x <no-reply@acme.local>',
    SMTP_USER: undefined,
    SMTP_PASS: undefined,
  };

  it('explains an unreachable server (a local port nothing listens on)', async () => {
    const probe = createServer().listen(0, '127.0.0.1');
    await new Promise((resolve) => probe.once('listening', resolve));
    const port = (probe.address() as { port: number }).port;
    await new Promise((resolve) => probe.close(resolve));
    const mailer = createSmtpMailer({ ...settings, SMTP_HOST: '127.0.0.1', SMTP_PORT: port });

    await expect(mailer.send(mail)).rejects.toThrow(
      `Could not connect to the mail server at 127.0.0.1:${port}. Check SMTP_HOST and SMTP_PORT.`,
    );
  });

  it('says email is not configured when there is no SMTP_HOST', async () => {
    const mailer = createSmtpMailer({ ...settings, SMTP_HOST: undefined, SMTP_PORT: 2525 });

    await expect(mailer.send(mail)).rejects.toThrow(
      'Email is not configured: set SMTP_HOST in the environment',
    );
  });
});
