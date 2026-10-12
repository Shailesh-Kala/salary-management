import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDb, testPool } from '../../test/db.ts';
import { createUser } from '../modules/auth/user-admin.ts';
import { seedDatabase } from './seed.ts';

const options = {
  count: 200,
  seed: 42,
  today: '2026-10-12',
  admin: { email: 'hr@acme.local', password: 'seed admin password' },
};

const count = async (sql: string) => (await testPool.query(sql)).rows[0].n as number;

beforeEach(resetDb);
afterAll(() => testPool.end());

describe('seedDatabase', () => {
  it('inserts employees with a hire change each, plus an exit change for leavers', async () => {
    const result = await seedDatabase(testPool, options);

    const leavers = await count(
      'SELECT count(*)::int AS n FROM employees WHERE exit_type IS NOT NULL',
    );
    expect(result).toEqual({ employees: 200, changes: 200 + leavers });
    expect(await count('SELECT count(*)::int AS n FROM employees')).toBe(200);
    expect(
      await count("SELECT count(*)::int AS n FROM employee_changes WHERE change_type = 'hire'"),
    ).toBe(200);
    expect(
      await count("SELECT count(*)::int AS n FROM employee_changes WHERE change_type = 'exit'"),
    ).toBe(leavers);
    expect(
      await count("SELECT count(*)::int AS n FROM employee_changes WHERE source <> 'seed'"),
    ).toBe(0);
    expect(
      await count("SELECT count(*)::int AS n FROM hr_users WHERE email = 'hr@acme.local'"),
    ).toBe(1);
  });

  it('stores hire snapshots in the country currency', async () => {
    await seedDatabase(testPool, options);

    const mismatched = await count(
      `SELECT count(*)::int AS n FROM employee_changes ch
         JOIN countries c ON c.code = ch.country_code
        WHERE ch.currency_code <> c.currency_code`,
    );
    expect(mismatched).toBe(0);
  });

  it('refuses to seed a database that has employees unless reset is requested', async () => {
    await seedDatabase(testPool, options);

    await expect(seedDatabase(testPool, options)).rejects.toThrow(/already has employees/);
    await expect(seedDatabase(testPool, { ...options, reset: true })).resolves.toMatchObject({
      employees: 200,
    });
    expect(await count('SELECT count(*)::int AS n FROM employees')).toBe(200);
  });

  it('keeps an existing admin account as it is', async () => {
    const existing = await createUser(testPool, {
      email: 'hr@acme.local',
      name: 'Existing',
      password: 'their own password',
    });

    await seedDatabase(testPool, options);

    const { rows } = await testPool.query('SELECT id, name FROM hr_users');
    expect(rows).toEqual([{ id: existing.id, name: 'Existing' }]);
  });
});
