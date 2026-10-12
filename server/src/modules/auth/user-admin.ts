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
