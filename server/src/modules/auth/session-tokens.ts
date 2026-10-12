import { jwtVerify, SignJWT } from 'jose';
import type { Clock } from '../../lib/clock.ts';

export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export type SessionClaims = { userId: string; tokenVersion: number };

export function createSessionTokens(secret: string, clock: Clock) {
  const key = new TextEncoder().encode(secret);

  return {
    issue: ({ userId, tokenVersion }: SessionClaims) => {
      const now = Math.floor(clock.now().getTime() / 1000);
      return new SignJWT({ tv: tokenVersion })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(userId)
        .setIssuedAt(now)
        .setExpirationTime(now + SESSION_TTL_SECONDS)
        .sign(key);
    },

    /** Returns null for any invalid, tampered or expired token. */
    verify: async (token: string): Promise<SessionClaims | null> => {
      try {
        const { payload } = await jwtVerify(token, key, {
          algorithms: ['HS256'],
          currentDate: clock.now(),
        });
        if (typeof payload.sub !== 'string' || typeof payload.tv !== 'number') return null;
        return { userId: payload.sub, tokenVersion: payload.tv };
      } catch {
        return null;
      }
    },
  };
}

export type SessionTokens = ReturnType<typeof createSessionTokens>;
