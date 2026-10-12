import { pino } from 'pino';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig(process.env);
const logger = pino();

createApp({ logger }).listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'server listening');
});
