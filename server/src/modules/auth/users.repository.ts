import type { Pool, PoolClient } from 'pg';

export type HrUser = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  tokenVersion: number;
  disabledAt: Date | null;
};

const COLUMNS = `id, email, name, password_hash AS "passwordHash",
  token_version AS "tokenVersion", disabled_at AS "disabledAt"`;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function createUsersRepository(db: Pool | PoolClient) {
  const one = async (sql: string, params: unknown[]) =>
    (await db.query<HrUser>(sql, params)).rows[0] ?? null;

  return {
    findByEmail: (email: string) =>
      one(`SELECT ${COLUMNS} FROM hr_users WHERE email = $1`, [email]),

    findById: (id: string) => one(`SELECT ${COLUMNS} FROM hr_users WHERE id = $1`, [id]),

    insert: async (user: { email: string; name: string; passwordHash: string }) =>
      (await one(
        `INSERT INTO hr_users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING ${COLUMNS}`,
        [user.email, user.name, user.passwordHash],
      )) as HrUser,

    /** Ends every existing session for the user. */
    bumpTokenVersion: async (id: string) => {
      await db.query('UPDATE hr_users SET token_version = token_version + 1 WHERE id = $1', [id]);
    },

    disableByEmail: async (email: string) => {
      const { rowCount } = await db.query(
        `UPDATE hr_users SET disabled_at = coalesce(disabled_at, now()), token_version = token_version + 1
          WHERE email = $1`,
        [email],
      );
      return rowCount === 1;
    },
  };
}

export type UsersRepository = ReturnType<typeof createUsersRepository>;
