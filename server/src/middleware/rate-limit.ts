import type { Request, RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { AppError } from '../lib/errors.ts';

// ponytail: in-memory counters are per process; use a shared store (e.g. Redis) if the API is scaled out.
function perMinute(limit: number, keyGenerator: (req: Request) => string) {
  return rateLimit({
    windowMs: 60_000,
    limit,
    keyGenerator,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(new AppError('RATE_LIMITED', 429, 'Too many requests — please try again shortly')),
  });
}

const ipOf = (req: Request) => ipKeyGenerator(req.ip ?? '');

/** Per IP stops one machine spraying many accounts; per IP + email slows guessing one (D-042). */
export function loginRateLimits(): RequestHandler[] {
  return [
    perMinute(20, ipOf),
    perMinute(
      5,
      (req) =>
        `${ipOf(req)}|${String(req.body?.email ?? '')
          .trim()
          .toLowerCase()}`,
    ),
  ];
}

/** Runs after requireAuth, so every request has a user. */
export const apiRateLimit = () => perMinute(300, (req) => req.user!.id);
