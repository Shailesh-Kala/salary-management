import type { Pool } from 'pg';
import { jobHandlers } from '../src/jobs/handlers.ts';
import type { Clock } from '../src/lib/clock.ts';
import type { Mailer } from '../src/lib/mailer.ts';
import { testConfig } from './app.ts';
import { testPool } from './db.ts';
import { fakeMailer } from './mailer.ts';

/** The real job handlers on the test database, with a fake mailer unless one is given. */
export function testJobHandlers({
  clock,
  mailer = fakeMailer(),
  db = testPool,
}: {
  clock: Clock;
  mailer?: Mailer;
  db?: Pool;
}) {
  return jobHandlers({ db, clock, mailer, appBaseUrl: testConfig.APP_BASE_URL });
}
