import type { Pool } from 'pg';
import { type Logger, pino } from 'pino';
import { jobHandlers } from '../src/jobs/handlers.ts';
import type { Clock } from '../src/lib/clock.ts';
import type { Mailer } from '../src/lib/mailer.ts';
import { testConfig } from './app.ts';
import { testPool } from './db.ts';
import { fakeMailer } from './mailer.ts';

/** The real job handlers on the test database, with a fake mailer and a silent logger unless given. */
export function testJobHandlers({
  clock,
  mailer = fakeMailer(),
  logger = pino({ level: 'silent' }),
  db = testPool,
}: {
  clock: Clock;
  mailer?: Mailer;
  logger?: Logger;
  db?: Pool;
}) {
  return jobHandlers({ db, clock, mailer, logger, appBaseUrl: testConfig.APP_BASE_URL });
}
