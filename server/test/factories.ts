import { testPool } from './db.ts';

export type EmployeeFixture = {
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
};

const defaults: EmployeeFixture = {
  employeeCode: 'EMP-001',
  firstName: 'Asha',
  lastName: 'Verma',
  email: 'asha.verma@acme.com',
  jobTitle: 'Software Engineer',
  department: 'Engineering',
  countryCode: 'IN',
  hireDate: '2024-04-01',
  baseSalary: '1800000',
  allowances: '0',
  exitType: null,
  noticeDate: null,
  lastWorkingDay: null,
};

/** Inserts an employee row directly (no hire change) for read-side tests. */
export async function insertEmployee(overrides: Partial<EmployeeFixture> = {}) {
  const e = { ...defaults, ...overrides };
  const { rows } = await testPool.query<{ id: string }>(
    `INSERT INTO employees (employee_code, first_name, last_name, email, job_title, department,
       country_code, hire_date, base_salary, allowances, exit_type, notice_date, last_working_day)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
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
      e.exitType,
      e.noticeDate,
      e.lastWorkingDay,
    ],
  );
  return rows[0]!.id;
}
