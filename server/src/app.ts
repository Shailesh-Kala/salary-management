import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import type { Config } from './config.ts';
import type { Clock } from './lib/clock.ts';
import { AppError } from './lib/errors.ts';
import { requireAuth } from './middleware/auth.ts';
import { errorHandler } from './middleware/error-handler.ts';
import { apiRateLimit } from './middleware/rate-limit.ts';
import { authRoutes } from './modules/auth/auth.routes.ts';
import { createAuthService } from './modules/auth/auth.service.ts';
import { createSessionTokens } from './modules/auth/session-tokens.ts';
import { createUsersRepository } from './modules/auth/users.repository.ts';
import { employeeRepositories } from './modules/employees/employees.repository.ts';
import { employeeRoutes } from './modules/employees/employees.routes.ts';
import { createEmployeesService } from './modules/employees/employees.service.ts';
import { insightRepositories } from './modules/insights/insights.repository.ts';
import { insightRoutes } from './modules/insights/insights.routes.ts';
import { createInsightsService } from './modules/insights/insights.service.ts';
import { exportRepositories } from './modules/exports/exports.repository.ts';
import { exportRoutes } from './modules/exports/exports.routes.ts';
import { createExportsService } from './modules/exports/exports.service.ts';
import { rateRepositories } from './modules/rates/rates.repository.ts';
import { slipRepositories } from './modules/slips/slips.repository.ts';
import { slipRoutes } from './modules/slips/slips.routes.ts';
import { createSlipsService } from './modules/slips/slips.service.ts';
import { rateRoutes } from './modules/rates/rates.routes.ts';
import { createRatesService } from './modules/rates/rates.service.ts';
import { withTransaction } from './db/transaction.ts';

export type AppDeps = { logger: Logger; db: Pool; clock: Clock; config: Config };

// Accept a caller's request ID only if it can't inject anything into logs or headers.
const SAFE_REQUEST_ID = /^[\w-]{1,64}$/;

export function createApp({ logger, db, clock, config }: AppDeps) {
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
      // Only what's needed to trace a request: no headers (cookies), query strings or bodies.
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, path: String(req.url).split('?')[0] }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  // HSTS only makes sense when served over HTTPS, which is when the cookie is Secure.
  app.use(helmet({ strictTransportSecurity: config.COOKIE_SECURE }));
  app.use(cors({ origin: [config.CORS_ORIGIN], credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/health', async (req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ status: 'ok', db: 'ok' });
    } catch (err) {
      req.log.warn({ err }, 'health check: database unavailable');
      res.status(503).json({ status: 'error', db: 'down' });
    }
  });

  const auth = createAuthService({
    users: createUsersRepository(db),
    tokens: createSessionTokens(config.JWT_SECRET, clock),
  });
  const { publicRoutes, protectedRoutes } = authRoutes(auth, config);
  const employees = createEmployeesService({
    clock,
    repos: employeeRepositories(db),
    inTransaction: (fn) => withTransaction(db, (client) => fn(employeeRepositories(client))),
  });

  // Everything under /api needs a session except the routes registered before requireAuth.
  const api = express.Router();
  api.use(publicRoutes);
  api.use(requireAuth(auth));
  api.use(apiRateLimit());
  api.use(protectedRoutes);
  api.use(employeeRoutes(employees));
  api.use(exportRoutes(createExportsService({ clock, employees, repos: exportRepositories(db) })));
  api.use(slipRoutes(createSlipsService({ clock, repos: slipRepositories(db) })));
  api.use(
    insightRoutes(
      createInsightsService({
        clock,
        repos: insightRepositories(db),
        rates: rateRepositories(db),
      }),
    ),
  );
  api.use(
    rateRoutes(
      createRatesService({
        clock,
        repos: rateRepositories(db),
        inTransaction: (fn) => withTransaction(db, (client) => fn(rateRepositories(client))),
      }),
    ),
  );
  app.use('/api', api);

  app.use((req, _res, next) => {
    next(new AppError('NOT_FOUND', 404, `Route ${req.method} ${req.path} not found`));
  });
  app.use(errorHandler);

  return app;
}
