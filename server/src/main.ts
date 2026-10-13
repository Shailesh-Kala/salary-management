import { pino } from 'pino';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createPool } from './db/pool.ts';
import { jobHandlers } from './jobs/handlers.ts';
import { createQueue } from './jobs/queue.ts';
import { createWorker } from './jobs/worker.ts';
import { createClock } from './lib/clock.ts';

const config = loadConfig(process.env);
const logger = pino();
const db = createPool(config.DATABASE_URL);
const clock = createClock(config.APP_TIMEZONE);

const worker = createWorker({
  queue: createQueue(db, clock),
  handlers: jobHandlers({ db, clock }),
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
