import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors.ts';
import type { AuthService, AuthUser } from '../modules/auth/auth.service.ts';
import { SESSION_COOKIE } from '../modules/auth/auth.routes.ts';

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export function requireAuth(auth: AuthService): RequestHandler {
  return async (req, _res, next) => {
    const user = await auth.authenticate(req.cookies?.[SESSION_COOKIE]);
    if (!user) throw new AppError('UNAUTHENTICATED', 401, 'Authentication required');
    req.user = user;
    next();
  };
}
