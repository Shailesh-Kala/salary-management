import { randomUUID } from 'node:crypto';
import { AppError } from '../../lib/errors.ts';
import { hashPassword, verifyPassword, type WarnLog } from './password.ts';
import type { SessionTokens } from './session-tokens.ts';
import { type HrUser, normalizeEmail, type UsersRepository } from './users.repository.ts';

export type AuthUser = { id: string; email: string; name: string };

const toAuthUser = ({ id, email, name }: HrUser): AuthUser => ({ id, email, name });

export function createAuthService({
  users,
  tokens,
}: {
  users: UsersRepository;
  tokens: SessionTokens;
}) {
  let dummyHash: Promise<string> | undefined;

  return {
    async login(email: string, password: string, log: WarnLog) {
      const user = await users.findByEmail(normalizeEmail(email));
      // Unknown emails still pay for a hash, so response time doesn't reveal which accounts exist.
      const hash = user?.passwordHash ?? (await (dummyHash ??= hashPassword(randomUUID())));
      const passwordOk = await verifyPassword(password, hash, log);

      if (!user || !passwordOk || user.disabledAt) {
        throw new AppError('UNAUTHENTICATED', 401, 'Invalid email or password');
      }
      const token = await tokens.issue({ userId: user.id, tokenVersion: user.tokenVersion });
      return { user: toAuthUser(user), token };
    },

    /** Re-checks the user on every request, so disable and logout take effect immediately (D-038). */
    async authenticate(token: string | undefined): Promise<AuthUser | null> {
      const claims = token ? await tokens.verify(token) : null;
      if (!claims) return null;
      const user = await users.findById(claims.userId);
      if (!user || user.disabledAt || user.tokenVersion !== claims.tokenVersion) return null;
      return toAuthUser(user);
    },

    logout: (userId: string) => users.bumpTokenVersion(userId),
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
