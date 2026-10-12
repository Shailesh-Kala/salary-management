import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../lib/errors.ts';
import { createAuthService } from './auth.service.ts';
import { verifyPassword } from './password.ts';
import type { SessionTokens } from './session-tokens.ts';
import type { HrUser, UsersRepository } from './users.repository.ts';

vi.mock('./password.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./password.ts')>();
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});

const log = { warn: vi.fn() };
const tokens = { issue: async () => 'token', verify: async () => null } as SessionTokens;

function serviceWith(user: HrUser | null) {
  const users = { findByEmail: async () => user } as unknown as UsersRepository;
  return createAuthService({ users, tokens });
}

const user = (overrides: Partial<HrUser> = {}): HrUser => ({
  id: 'u1',
  email: 'hr@acme.local',
  name: 'HR',
  passwordHash: 'scrypt$32768$8$1$c2FsdA==$a2V5', // malformed on purpose: verify returns false
  tokenVersion: 1,
  disabledAt: null,
  ...overrides,
});

beforeEach(() => {
  vi.mocked(verifyPassword).mockClear(); // braces: a returned function would run as a cleanup hook
});

describe('authService.login failure paths', () => {
  it.each([
    ['an unknown email', null],
    ['a wrong password', user()],
    ['a disabled user', user({ disabledAt: new Date('2026-10-01T00:00:00Z') })],
  ])('for %s: checks one password hash, then throws the same generic 401', async (_case, found) => {
    const attempt = serviceWith(found).login('hr@acme.local', 'pw', log);

    await expect(attempt).rejects.toEqual(
      new AppError('UNAUTHENTICATED', 401, 'Invalid email or password'),
    );
    expect(verifyPassword).toHaveBeenCalledOnce();
  });
});
