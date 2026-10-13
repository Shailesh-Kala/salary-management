import { readdirSync } from 'node:fs';
import path from 'node:path';
import { runner } from 'node-pg-migrate';
import type { Pool } from 'pg';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '../../migrations');
const MIGRATIONS_TABLE = 'pgmigrations';

export async function migrate(databaseUrl: string, log: (msg: string) => void = () => {}) {
  await runner({
    databaseUrl,
    dir: MIGRATIONS_DIR,
    direction: 'up',
    migrationsTable: MIGRATIONS_TABLE,
    log,
  });
}

/** Migration files the database has not applied yet, in order (without the .sql extension). */
export async function pendingMigrations(db: Pool, dir = MIGRATIONS_DIR) {
  const { rows } = await db.query<{ name: string }>(`SELECT name FROM ${MIGRATIONS_TABLE}`);
  const applied = new Set(rows.map((r) => r.name));
  return readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => file.slice(0, -'.sql'.length))
    .filter((name) => !applied.has(name))
    .sort();
}

/** Fails with the fix when the database is behind the code, instead of failing later per request. */
export async function assertMigrated(db: Pool, dir?: string) {
  const pending = await pendingMigrations(db, dir);
  if (pending.length > 0) {
    throw new Error(
      `The database is missing migrations: ${pending.join(', ')}. Run "npm run migrate -w server" first.`,
    );
  }
}
