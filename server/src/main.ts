import { pino } from 'pino';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { assertMigrated } from './db/migrate.ts';
import { createPool } from './db/pool.ts';
import { jobHandlers } from './jobs/handlers.ts';
import { createQueue } from './jobs/queue.ts';
import { createWorker } from './jobs/worker.ts';
import { createClock } from './lib/clock.ts';
import { createSmtpMailer } from './lib/mailer.ts';

const config = loadConfig(process.env);
const logger = pino();
const db = createPool(config.DATABASE_URL);
const clock = createClock(config.APP_TIMEZONE);

try {
  await assertMigrated(db);
} catch (err) {
  logger.fatal({ err: err instanceof Error ? err.message : err }, 'cannot start');
  process.exit(1);
}

const worker = createWorker({
  queue: createQueue(db, clock),
  handlers: jobHandlers({
    db,
    clock,
    mailer: createSmtpMailer(config),
    logger,
    appBaseUrl: config.APP_BASE_URL,
  }),
  logger,
});
const server = createApp({ logger, db, clock, config }).listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'server listening');
});
worker.start();

/** Stop taking requests, let the worker finish its current job, then close the pool. */
async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  server.close();
  server.closeIdleConnections();
  await worker.stop();
  await db.end();
  process.exit(0);
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
