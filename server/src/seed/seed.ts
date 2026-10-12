import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../db/transaction.ts';
import { hashPassword } from '../modules/auth/password.ts';
import { createUsersRepository, normalizeEmail } from '../modules/auth/users.repository.ts';
import { generateEmployees, type SeedEmployee } from './generate.ts';

export type SeedOptions = {
  count: number;
  seed: number;
  today: string;
  admin: { email: string; password: string };
  /** Wipe employees and their history and restore the rate snapshot first. */
  reset?: boolean;
};

const BATCH_SIZE = 1000;

/** Inserts generated employees, a hire change each and an exit change for leavers, in one transaction. */
export async function seedDatabase(db: Pool, options: SeedOptions) {
  const employees = generateEmployees(options);

  return withTransaction(db, async (client) => {
    const existing = (await client.query('SELECT count(*)::int AS n FROM employees')).rows[0].n;
    if (existing > 0 && !options.reset) {
      throw new Error('Database already has employees — run with --reset to replace them');
    }
    if (options.reset) {
      await client.query('TRUNCATE employees, employee_changes RESTART IDENTITY');
      await client.query('SELECT load_reference_data()');
    }

    const adminId = await ensureAdmin(client, options.admin);
    const { rows } = await client.query<{ code: string; currency: string }>(
      'SELECT code, currency_code AS currency FROM countries',
    );
    const currencyOf = new Map(rows.map((r) => [r.code, r.currency]));

    let changes = 0;
    for (let i = 0; i < employees.length; i += BATCH_SIZE) {
      const batch = employees.slice(i, i + BATCH_SIZE);
      const ids = await insertEmployees(client, batch);
      changes += await insertChanges(client, batch, ids, currencyOf, adminId);
    }
    return { employees: employees.length, changes };
  });
}

async function ensureAdmin(client: PoolClient, admin: SeedOptions['admin']) {
  const users = createUsersRepository(client);
  const email = normalizeEmail(admin.email);
  const existing = await users.findByEmail(email);
  if (existing) return existing.id;
  const passwordHash = await hashPassword(admin.password);
  return (await users.insert({ email, name: 'HR Manager', passwordHash })).id;
}

async function insertEmployees(client: PoolClient, batch: SeedEmployee[]) {
  const column = (key: keyof SeedEmployee) => batch.map((e) => e[key]);
  const { rows } = await client.query<{ id: string; employee_code: string }>(
    `INSERT INTO employees (employee_code, first_name, last_name, email, job_title, department,
       country_code, hire_date, base_salary, allowances, exit_type, notice_date, last_working_day)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
       $7::char(2)[], $8::date[], $9::numeric[], $10::numeric[], $11::text[], $12::date[],
       $13::date[])
     RETURNING id, employee_code`,
    [
      column('employeeCode'),
      column('firstName'),
      column('lastName'),
      column('email'),
      column('jobTitle'),
      column('department'),
      column('countryCode'),
      column('hireDate'),
      column('baseSalary'),
      column('allowances'),
      column('exitType'),
      column('noticeDate'),
      column('lastWorkingDay'),
    ],
  );
  return new Map(rows.map((r) => [r.employee_code, r.id]));
}

async function insertChanges(
  client: PoolClient,
  batch: SeedEmployee[],
  ids: Map<string, string>,
  currencyOf: Map<string, string>,
  adminId: string,
) {
  const changes = batch.flatMap((e) => {
    const common = {
      employeeId: ids.get(e.employeeCode)!,
      snapshot: [
        e.baseSalary,
        e.allowances,
        currencyOf.get(e.countryCode)!,
        e.countryCode,
        e.jobTitle,
        e.department,
      ],
    };
    const hire = {
      ...common,
      type: 'hire',
      date: e.hireDate,
      note: 'Seeded employee record',
      changes: {
        baseSalary: { old: null, new: e.baseSalary },
        allowances: { old: null, new: e.allowances },
        jobTitle: { old: null, new: e.jobTitle },
        department: { old: null, new: e.department },
        countryCode: { old: null, new: e.countryCode },
      },
    };
    if (!e.exitType) return [hire];
    const exit = {
      ...common,
      type: 'exit',
      date: e.noticeDate!,
      note: 'Seeded exit record',
      changes: {
        exitType: { old: null, new: e.exitType },
        noticeDate: { old: null, new: e.noticeDate },
        lastWorkingDay: { old: null, new: e.lastWorkingDay },
      },
    };
    return [hire, exit];
  });

  const column = (pick: (c: (typeof changes)[number]) => unknown) => changes.map(pick);
  await client.query(
    `INSERT INTO employee_changes (employee_id, change_type, effective_date, note, source, changes,
       base_salary, allowances, currency_code, country_code, job_title, department, changed_by,
       changed_at)
     SELECT employee_id, change_type, effective_date, note, 'seed', changes, base_salary,
       allowances, currency_code, country_code, job_title, department, $11, effective_date::timestamptz
     FROM unnest($1::uuid[], $2::text[], $3::date[], $4::text[], $5::jsonb[], $6::numeric[],
       $7::numeric[], $8::char(3)[], $9::char(2)[], $10::text[], $12::text[])
       AS t(employee_id, change_type, effective_date, note, changes, base_salary, allowances,
            currency_code, country_code, job_title, department)`,
    [
      column((c) => c.employeeId),
      column((c) => c.type),
      column((c) => c.date),
      column((c) => c.note),
      column((c) => JSON.stringify(c.changes)),
      column((c) => c.snapshot[0]),
      column((c) => c.snapshot[1]),
      column((c) => c.snapshot[2]),
      column((c) => c.snapshot[3]),
      column((c) => c.snapshot[4]),
      adminId,
      column((c) => c.snapshot[5]),
    ],
  );
  return changes.length;
}
