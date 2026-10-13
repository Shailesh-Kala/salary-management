import type { Pool } from 'pg';
import type { SlipEmployee, SlipSnapshot } from './slip.ts';

const SNAPSHOT = `SELECT ch.base_salary AS "baseSalary", ch.allowances,
    ch.currency_code AS "currencyCode", ch.country_code AS "countryCode",
    c.name AS "countryName", ch.job_title AS "jobTitle", ch.department
  FROM employee_changes ch JOIN countries c ON c.code = ch.country_code
  WHERE ch.employee_id = $1`;

export function slipRepositories(db: Pool) {
  return {
    findEmployee: async (id: string) =>
      (
        await db.query<SlipEmployee>(
          `SELECT id, employee_code AS "employeeCode", first_name AS "firstName",
                  last_name AS "lastName", hire_date AS "hireDate", exit_type AS "exitType",
                  notice_date AS "noticeDate", last_working_day AS "lastWorkingDay"
             FROM employees WHERE id = $1`,
          [id],
        )
      ).rows[0] ?? null,

    /**
     * The latest snapshot effective on or before `date`; if a corrected (earlier) hire date puts
     * `date` before every snapshot, the earliest one.
     */
    snapshotAt: async (employeeId: string, date: string) => {
      const atDate = await db.query<SlipSnapshot>(
        `${SNAPSHOT} AND ch.effective_date <= $2 ORDER BY ch.effective_date DESC, ch.id DESC LIMIT 1`,
        [employeeId, date],
      );
      if (atDate.rows[0]) return atDate.rows[0];
      const earliest = await db.query<SlipSnapshot>(
        `${SNAPSHOT} ORDER BY ch.effective_date, ch.id LIMIT 1`,
        [employeeId],
      );
      return earliest.rows[0] ?? null;
    },
  };
}

export type SlipRepos = ReturnType<typeof slipRepositories>;
