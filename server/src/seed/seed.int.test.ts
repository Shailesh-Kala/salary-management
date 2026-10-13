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
  it('inserts employees with a hire change each, an exit change for leavers, and pay history', async () => {
    const result = await seedDatabase(testPool, options);

    const leavers = await count(
      'SELECT count(*)::int AS n FROM employees WHERE exit_type IS NOT NULL',
    );
    const history = await count(
      "SELECT count(*)::int AS n FROM employee_changes WHERE change_type IN ('annual_review', 'promotion', 'relocation')",
    );
    expect(history).toBeGreaterThan(100);
    expect(result).toEqual({ employees: 200, changes: 200 + leavers + history });
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

  it('ends each employee at the values of their latest pay or title change', async () => {
    await seedDatabase(testPool, options);

    const mismatched = await count(
      `SELECT count(*)::int AS n
         FROM employees e
         JOIN LATERAL (SELECT * FROM employee_changes ch
                        WHERE ch.employee_id = e.id AND ch.change_type <> 'exit'
                        ORDER BY ch.effective_date DESC, ch.id DESC LIMIT 1) last ON true
        WHERE (last.base_salary, last.allowances, last.job_title, last.country_code)
              IS DISTINCT FROM (e.base_salary, e.allowances, e.job_title, e.country_code)`,
    );
    expect(mismatched).toBe(0);
  });

  it('stores every snapshot in the currency of its country', async () => {
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
