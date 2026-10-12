import { createPool } from '../src/db/pool.ts';
import { testDatabaseUrl } from './test-database.ts';

export const testPool = createPool(testDatabaseUrl());

/** Empties every table, then restores countries and the rate snapshot. */
export async function resetDb() {
  const { rows } = await testPool.query(
    `SELECT string_agg(format('%I', tablename), ', ') AS tables
       FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'pgmigrations'`,
  );
  await testPool.query(`TRUNCATE ${rows[0].tables} RESTART IDENTITY CASCADE`);
  await testPool.query('SELECT load_reference_data()');
}
