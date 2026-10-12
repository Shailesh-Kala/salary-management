import { pino } from 'pino';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createPool } from './db/pool.ts';

const config = loadConfig(process.env);
const logger = pino();

const db = createPool(config.DATABASE_URL);

createApp({ logger, db }).listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'server listening');
});
