import type { Pool, PoolClient } from 'pg';
import type { AuditedField } from './changes.ts';
import type { ListEmployeesQuery } from './employee.schemas.ts';
import type { EmployeeStatus } from './status.ts';

export type EmployeeRow = {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string;
  department: string;
  countryCode: string;
  hireDate: string;
  baseSalary: string;
  allowances: string;
  exitType: 'resigned' | 'terminated' | null;
  noticeDate: string | null;
  lastWorkingDay: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type NewEmployee = Pick<
  EmployeeRow,
  | 'employeeCode'
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'jobTitle'
  | 'department'
  | 'countryCode'
  | 'hireDate'
  | 'baseSalary'
  | 'allowances'
>;

export type EmployeeDetail = EmployeeRow & { currencyCode: string; countryName: string };

/** Values in effect after a change. */
export type Snapshot = Pick<
  EmployeeRow,
  'baseSalary' | 'allowances' | 'countryCode' | 'jobTitle' | 'department'
> & { currencyCode: string };

export type NewChange = {
  employeeId: string;
  changeType: string;
  effectiveDate: string;
  note: string;
  source: 'ui' | 'import' | 'seed';
  changes: Record<string, { old: unknown; new: unknown }>;
  snapshot: Snapshot;
  changedBy: string;
  changedAt: Date;
};

const EMPLOYEE_COLUMNS = `id, employee_code AS "employeeCode", first_name AS "firstName",
  last_name AS "lastName", email, job_title AS "jobTitle", department,
  country_code AS "countryCode", hire_date AS "hireDate", base_salary AS "baseSalary",
  allowances, exit_type AS "exitType", notice_date AS "noticeDate",
  last_working_day AS "lastWorkingDay", version, created_at AS "createdAt",
  updated_at AS "updatedAt"`;

export type EmployeeListItem = Pick<
  EmployeeRow,
  | 'id'
  | 'employeeCode'
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'jobTitle'
  | 'department'
  | 'countryCode'
  | 'hireDate'
  | 'baseSalary'
  | 'allowances'
  | 'lastWorkingDay'
> & {
  currencyCode: string;
  annualSalary: string;
  convertedAnnualSalary: string;
  status: EmployeeStatus;
};

// Must match employees_search_idx so the trigram index is used.
const SEARCH_EXPR = `lower(e.first_name || ' ' || e.last_name || ' ' || e.email || ' ' || e.employee_code)`;

// Whitelisted ORDER BY columns; user input never reaches SQL as text.
const SORT_SQL: Record<ListEmployeesQuery['sort'], string[]> = {
  name: ['e.last_name', 'e.first_name'],
  employeeCode: ['e.employee_code'],
  jobTitle: ['e.job_title'],
  department: ['e.department'],
  country: ['e.country_code'],
  hireDate: ['e.hire_date'],
  annualSalary: ['"convertedAnnualSalary"'],
};

const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&');

const COUNTRY_COLUMNS = `c.currency_code AS "currencyCode", c.name AS "countryName"`;

// Whitelisted columns a change event may set.
const AUDITED_COLUMNS: Record<AuditedField, string> = {
  baseSalary: 'base_salary',
  allowances: 'allowances',
  jobTitle: 'job_title',
  department: 'department',
  countryCode: 'country_code',
  hireDate: 'hire_date',
};

export type HistoryEntry = {
  id: string;
  changeType: string;
  effectiveDate: string;
  note: string;
  source: 'ui' | 'import' | 'seed';
  changes: Record<string, { old: unknown; new: unknown }>;
  snapshot: Snapshot;
  changedBy: { id: string; name: string };
  changedAt: Date;
};

const HISTORY_COLUMNS = `ch.id::text AS id, ch.change_type AS "changeType",
  ch.effective_date AS "effectiveDate", ch.note, ch.source, ch.changes,
  json_build_object('baseSalary', ch.base_salary::text, 'allowances', ch.allowances::text,
    'currencyCode', ch.currency_code, 'countryCode', ch.country_code,
    'jobTitle', ch.job_title, 'department', ch.department) AS snapshot,
  json_build_object('id', u.id, 'name', u.name) AS "changedBy", ch.changed_at AS "changedAt"`;

/** Repositories bound to one connection, so callers can run them inside a transaction. */
export function employeeRepositories(db: Pool | PoolClient) {
  return {
    employees: {
      /** Oldest rate date (conversions are only as fresh as it) and whether `currency` exists. */
      ratesInfo: async (currency: string) =>
        (
          await db.query<{ asOf: string; known: boolean }>(
            `SELECT min(as_of) AS "asOf", coalesce(bool_or(currency_code = $1), false) AS known
               FROM exchange_rates`,
            [currency],
          )
        ).rows[0]!,

      list: async (f: ListEmployeesQuery, today: string) => {
        const params: unknown[] = [];
        const p = (value: unknown) => `$${params.push(value)}`;
        let todayParam: string | undefined;
        const status = () =>
          `CASE WHEN e.last_working_day IS NULL THEN 'active'
                WHEN e.last_working_day >= ${(todayParam ??= p(today))} THEN 'on_notice'
                ELSE 'exited' END`;

        const where = [`rt.currency_code = ${p(f.currency)}`];
        if (f.country) where.push(`e.country_code = ${p(f.country)}`);
        if (f.department) where.push(`e.department = ${p(f.department)}`);
        if (f.jobTitle) where.push(`e.job_title = ${p(f.jobTitle)}`);
        if (f.status) where.push(`${status()} = ${p(f.status)}`);
        if (f.q) where.push(`${SEARCH_EXPR} LIKE ${p(`%${escapeLike(f.q.toLowerCase())}%`)}`);

        const from = `FROM employees e
          JOIN countries c ON c.code = e.country_code
          JOIN exchange_rates rf ON rf.currency_code = c.currency_code
          CROSS JOIN exchange_rates rt
          WHERE ${where.join(' AND ')}`;
        const countParams = [...params];

        const order = SORT_SQL[f.sort].map((col) => `${col} ${f.order}`).join(', ');
        const { rows: items } = await db.query<EmployeeListItem>(
          `SELECT e.id, e.employee_code AS "employeeCode", e.first_name AS "firstName",
             e.last_name AS "lastName", e.email, e.job_title AS "jobTitle", e.department,
             e.country_code AS "countryCode", c.currency_code AS "currencyCode",
             e.hire_date AS "hireDate", e.base_salary AS "baseSalary", e.allowances,
             e.base_salary + e.allowances AS "annualSalary",
             round((e.base_salary + e.allowances) * rf.inr_per_unit / rt.inr_per_unit, 2)
               AS "convertedAnnualSalary",
             ${status()} AS status, e.last_working_day AS "lastWorkingDay"
           ${from}
           ORDER BY ${order}, e.id
           LIMIT ${p(f.pageSize)} OFFSET ${p((f.page - 1) * f.pageSize)}`,
          params,
        );
        const { rows } = await db.query<{ total: number }>(
          `SELECT count(*)::int AS total ${from}`,
          countParams,
        );
        return { items, total: rows[0]!.total };
      },

      /** Choices for the list filters: reference data plus the values actually in use. */
      filterOptions: async () => {
        const values = async (sql: string) =>
          (await db.query<{ value: string }>(sql)).rows.map((r) => r.value);
        const { rows: countries } = await db.query<{
          code: string;
          name: string;
          currencyCode: string;
        }>('SELECT code, name, currency_code AS "currencyCode" FROM countries ORDER BY name');
        return {
          countries,
          departments: await values(
            'SELECT DISTINCT department AS value FROM employees ORDER BY 1',
          ),
          jobTitles: await values('SELECT DISTINCT job_title AS value FROM employees ORDER BY 1'),
          currencies: await values('SELECT currency_code AS value FROM exchange_rates ORDER BY 1'),
        };
      },

      findById: async (id: string) =>
        (
          await db.query<EmployeeDetail>(
            `SELECT ${EMPLOYEE_COLUMNS}, ${COUNTRY_COLUMNS}
               FROM employees JOIN countries c ON c.code = employees.country_code
              WHERE employees.id = $1`,
            [id],
          )
        ).rows[0] ?? null,

      /** Locks the row until the transaction ends, so concurrent change events queue up. */
      findForUpdate: async (id: string) =>
        (
          await db.query<EmployeeDetail>(
            `SELECT ${EMPLOYEE_COLUMNS}, ${COUNTRY_COLUMNS}
               FROM employees JOIN countries c ON c.code = employees.country_code
              WHERE employees.id = $1
                FOR UPDATE OF employees`,
            [id],
          )
        ).rows[0] ?? null,

      /** Sets the given audited fields and bumps the version. */
      applyChange: async (
        id: string,
        updates: Partial<Record<AuditedField, string>>,
        now: Date,
      ) => {
        const params: unknown[] = [id, now];
        const sets = Object.entries(updates).map(
          ([field, value]) => `${AUDITED_COLUMNS[field as AuditedField]} = $${params.push(value)}`,
        );
        const { rows } = await db.query<EmployeeDetail>(
          `WITH updated AS (
             UPDATE employees SET ${[...sets, 'version = version + 1', 'updated_at = $2'].join(', ')}
              WHERE id = $1
              RETURNING *)
           SELECT ${EMPLOYEE_COLUMNS}, ${COUNTRY_COLUMNS}
             FROM updated JOIN countries c ON c.code = updated.country_code`,
          params,
        );
        return rows[0] as EmployeeDetail;
      },

      /** Returns null when the id is unknown or `version` is stale (optimistic locking). */
      updateProfile: async (
        id: string,
        version: number,
        fields: Partial<Pick<EmployeeRow, 'firstName' | 'lastName' | 'email'>>,
        now: Date,
      ) =>
        (
          await db.query<EmployeeDetail>(
            `WITH updated AS (
               UPDATE employees
                  SET first_name = coalesce($3, first_name),
                      last_name = coalesce($4, last_name),
                      email = coalesce($5, email),
                      version = version + 1,
                      updated_at = $6
                WHERE id = $1 AND version = $2
                RETURNING *)
             SELECT ${EMPLOYEE_COLUMNS}, ${COUNTRY_COLUMNS}
               FROM updated JOIN countries c ON c.code = updated.country_code`,
            [id, version, fields.firstName, fields.lastName, fields.email, now],
          )
        ).rows[0] ?? null,

      findCountry: async (code: string) =>
        (
          await db.query<{ code: string; currencyCode: string; name: string }>(
            'SELECT code, name, currency_code AS "currencyCode" FROM countries WHERE code = $1',
            [code],
          )
        ).rows[0] ?? null,

      insert: async (e: NewEmployee) =>
        (
          await db.query<EmployeeRow>(
            `INSERT INTO employees (employee_code, first_name, last_name, email, job_title,
               department, country_code, hire_date, base_salary, allowances)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING ${EMPLOYEE_COLUMNS}`,
            [
              e.employeeCode,
              e.firstName,
              e.lastName,
              e.email,
              e.jobTitle,
              e.department,
              e.countryCode,
              e.hireDate,
              e.baseSalary,
              e.allowances,
            ],
          )
        ).rows[0] as EmployeeRow,
    },

    changes: {
      dateBounds: async (employeeId: string) =>
        (
          await db.query<{ latest: string | null; firstNonHire: string | null }>(
            `SELECT max(effective_date) AS latest,
                    min(effective_date) FILTER (WHERE change_type <> 'hire') AS "firstNonHire"
               FROM employee_changes WHERE employee_id = $1`,
            [employeeId],
          )
        ).rows[0]!,

      /** Newest first; ties on the same effective date go by insertion order. */
      listForEmployee: async (employeeId: string) =>
        (
          await db.query<HistoryEntry>(
            `SELECT ${HISTORY_COLUMNS}
               FROM employee_changes ch JOIN hr_users u ON u.id = ch.changed_by
              WHERE ch.employee_id = $1
              ORDER BY ch.effective_date DESC, ch.id DESC`,
            [employeeId],
          )
        ).rows,

      insert: async (c: NewChange) => {
        const s = c.snapshot;
        const { rows } = await db.query<HistoryEntry>(
          `WITH ch AS (
             INSERT INTO employee_changes (employee_id, change_type, effective_date, note, source,
               changes, base_salary, allowances, currency_code, country_code, job_title,
               department, changed_by, changed_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             RETURNING *)
           SELECT ${HISTORY_COLUMNS} FROM ch JOIN hr_users u ON u.id = ch.changed_by`,
          [
            c.employeeId,
            c.changeType,
            c.effectiveDate,
            c.note,
            c.source,
            JSON.stringify(c.changes),
            s.baseSalary,
            s.allowances,
            s.currencyCode,
            s.countryCode,
            s.jobTitle,
            s.department,
            c.changedBy,
            c.changedAt,
          ],
        );
        return rows[0] as HistoryEntry;
      },
    },
  };
}

export type EmployeeRepos = ReturnType<typeof employeeRepositories>;
