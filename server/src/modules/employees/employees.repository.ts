import type { Pool, PoolClient } from 'pg';

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

/** Repositories bound to one connection, so callers can run them inside a transaction. */
export function employeeRepositories(db: Pool | PoolClient) {
  return {
    employees: {
      findCountry: async (code: string) =>
        (
          await db.query<{ code: string; currencyCode: string }>(
            'SELECT code, currency_code AS "currencyCode" FROM countries WHERE code = $1',
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
      insert: async (c: NewChange) => {
        const s = c.snapshot;
        await db.query(
          `INSERT INTO employee_changes (employee_id, change_type, effective_date, note, source,
             changes, base_salary, allowances, currency_code, country_code, job_title, department,
             changed_by, changed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
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
      },
    },
  };
}

export type EmployeeRepos = ReturnType<typeof employeeRepositories>;
