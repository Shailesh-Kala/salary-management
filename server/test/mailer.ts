import type { Mail, Mailer } from '../src/lib/mailer.ts';

/** Collects delivered mail in `sent`; `failNext` makes the next sends throw before delivering. */
export function fakeMailer() {
  const sent: Mail[] = [];
  let failures = 0;
  return {
    sent,
    failNext(times = 1) {
      failures = times;
    },
    async send(mail: Mail) {
      if (failures > 0) {
        failures--;
        throw new Error('SMTP server unavailable');
      }
      sent.push(mail);
    },
  } satisfies Mailer & { sent: Mail[]; failNext(times?: number): void };
}
