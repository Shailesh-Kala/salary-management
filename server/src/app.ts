import { randomUUID } from 'node:crypto';
import express from 'express';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { AppError } from './lib/errors.ts';
import { errorHandler } from './middleware/error-handler.ts';

export type AppDeps = { logger: Logger; db: Pool };

// Accept a caller's request ID only if it can't inject anything into logs or headers.
const SAFE_REQUEST_ID = /^[\w-]{1,64}$/;

export function createApp({ logger, db }: AppDeps) {
  const app = express();

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id =
          typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
    }),
  );

  app.get('/health', async (req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ status: 'ok', db: 'ok' });
    } catch (err) {
      req.log.warn({ err }, 'health check: database unavailable');
      res.status(503).json({ status: 'error', db: 'down' });
    }
  });

  app.use((req, _res, next) => {
    next(new AppError('NOT_FOUND', 404, `Route ${req.method} ${req.path} not found`));
  });
  app.use(errorHandler);

  return app;
}
