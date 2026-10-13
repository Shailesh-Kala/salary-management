import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { testPool } from '../../test/db.ts';
import { assertMigrated, pendingMigrations } from './migrate.ts';

afterAll(() => testPool.end());

/** A migrations folder holding the given file names. */
function folder(...names: string[]) {
  const dir = mkdtempSync(path.join(tmpdir(), 'migrations-'));
  for (const name of names) writeFileSync(path.join(dir, name), '-- Up Migration\n');
  return dir;
}

describe('pendingMigrations', () => {
  it('is empty when every migration file has been applied (the test database is migrated)', async () => {
    expect(await pendingMigrations(testPool)).toEqual([]);
    await expect(assertMigrated(testPool)).resolves.toBeUndefined();
  });

  it('lists migration files the database has not applied, in order', async () => {
    const dir = folder(
      '0001_reference-data.sql',
      '9998_next.sql',
      '9999_after-next.sql',
      'README.md',
    );

    expect(await pendingMigrations(testPool, dir)).toEqual(['9998_next', '9999_after-next']);
  });

  it('refuses to start against a database that is behind, and says how to fix it', async () => {
    const dir = folder('9999_after-next.sql');

    await expect(assertMigrated(testPool, dir)).rejects.toThrow(
      'The database is missing migrations: 9999_after-next. Run "npm run migrate -w server" first.',
    );
  });
});
