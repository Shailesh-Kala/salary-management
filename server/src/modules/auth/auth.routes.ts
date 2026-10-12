import { type CookieOptions, Router } from 'express';
import { z } from 'zod';
import type { Config } from '../../config.ts';
import type { AuthService } from './auth.service.ts';
import { SESSION_TTL_SECONDS } from './session-tokens.ts';

export const SESSION_COOKIE = 'sid';

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(200),
});

export function authRoutes(auth: AuthService, config: Pick<Config, 'COOKIE_SECURE'>) {
  const cookieOptions: CookieOptions = {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.COOKIE_SECURE,
    path: '/',
  };

  const publicRoutes = Router();
  publicRoutes.post('/auth/login', async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const { user, token } = await auth.login(email, password, req.log);
    res.cookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: SESSION_TTL_SECONDS * 1000 });
    res.json({ user });
  });

  const protectedRoutes = Router();
  protectedRoutes.get('/auth/me', (req, res) => {
    res.json({ user: req.user });
  });
  protectedRoutes.post('/auth/logout', async (req, res) => {
    await auth.logout(req.user!.id);
    res.clearCookie(SESSION_COOKIE, cookieOptions);
    res.status(204).end();
  });

  return { publicRoutes, protectedRoutes };
}
