import type { Pool } from 'pg';
import { hashPassword } from './password.ts';
import { createUsersRepository, normalizeEmail } from './users.repository.ts';

export async function createUser(
  db: Pool,
  user: { email: string; name: string; password: string },
) {
  return createUsersRepository(db).insert({
    email: normalizeEmail(user.email),
    name: user.name.trim(),
    passwordHash: await hashPassword(user.password),
  });
}

/** Sets disabled_at and ends the user's sessions. Returns false if no such user. */
export function disableUser(db: Pool, email: string) {
  return createUsersRepository(db).disableByEmail(normalizeEmail(email));
}

export function enableUser(db: Pool, email: string) {
  return createUsersRepository(db).enableByEmail(normalizeEmail(email));
}

/** Sets a new password and ends existing sessions; the user keeps the same id and history. */
export async function resetPassword(db: Pool, email: string, password: string) {
  return createUsersRepository(db).setPasswordByEmail(
    normalizeEmail(email),
    await hashPassword(password),
  );
}
