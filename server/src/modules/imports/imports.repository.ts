import type { Pool, PoolClient } from 'pg';
import type { ImportForm } from './upload.ts';
import type { ExistingEmployee, RowContext, RowResult } from './validate-rows.ts';

export type ImportRecord = {
  id: string;
  status: string;
  confirmedBy: string | null;
  fileName: string;
  file: Buffer | null;
  changeType: ImportForm['changeType'];
  effectiveDate: string;
  note: string;
};

export function importRepositories(db: Pool | PoolClient) {
  return {
    insert: async (
      i: ImportForm & {
        uploadedBy: string;
        fileName: string;
        file: Buffer;
        rowCount: number;
        createdAt: Date;
      },
    ) =>
      (
        await db.query<{ id: string }>(
          `INSERT INTO imports (uploaded_by, file_name, status, change_type, effective_date, note,
             file, row_count, created_at)
           VALUES ($1, $2, 'validating', $3, $4, $5, $6, $7, $8) RETURNING id`,
          [
            i.uploadedBy,
            i.fileName,
            i.changeType,
            i.effectiveDate,
            i.note,
            i.file,
            i.rowCount,
            i.createdAt,
          ],
        )
      ).rows[0]!.id,

    find: async (id: string) =>
      (
        await db.query<ImportRecord>(
          `SELECT id, status, confirmed_by AS "confirmedBy", file_name AS "fileName", file,
                  change_type AS "changeType",
                  effective_date AS "effectiveDate", note
             FROM imports WHERE id = $1`,
          [id],
        )
      ).rows[0] ?? null,

    /** What HR sees: status, counts, expiry and who uploaded it. */
    details: async (id: string) =>
      (
        await db.query(
          `SELECT i.id, i.status, i.file_name AS "fileName", i.change_type AS "changeType",
                  i.effective_date AS "effectiveDate", i.note, i.row_count AS "rowCount", i.counts,
                  i.preview_expires_at AS "previewExpiresAt", i.error, i.created_at AS "createdAt",
                  i.finished_at AS "finishedAt",
                  json_build_object('id', u.id, 'name', u.name) AS "uploadedBy"
             FROM imports i JOIN hr_users u ON u.id = i.uploaded_by
            WHERE i.id = $1`,
          [id],
        )
      ).rows[0] ?? null,

    rejectedRows: async (id: string, limit?: number) =>
      (
        await db.query<{
          rowNumber: number;
          employeeCode: string | null;
          errors: string[];
          raw: Record<string, string> | null;
        }>(
          `SELECT row_number AS "rowNumber", employee_code AS "employeeCode", errors, raw
             FROM import_rows
            WHERE import_id = $1 AND coalesce(outcome, preview_outcome) = 'rejected'
            ORDER BY row_number
            LIMIT $2`,
          [id, limit ?? null],
        )
      ).rows,

    /** Everything the row rules need about current employees, loaded in two queries. */
    validationContext: async (form: ImportForm, today: string): Promise<RowContext> => {
      const { rows: employees } = await db.query<ExistingEmployee>(
        `SELECT e.id, e.employee_code AS "employeeCode", e.first_name AS "firstName",
                e.last_name AS "lastName", e.email, e.job_title AS "jobTitle", e.department,
                e.country_code AS "countryCode", c.currency_code AS "currencyCode",
                e.hire_date AS "hireDate", e.base_salary AS "baseSalary", e.allowances,
                e.exit_type AS "exitType", e.notice_date AS "noticeDate",
                e.last_working_day AS "lastWorkingDay", e.version,
                h.latest AS "latestEffectiveDate", h.first_non_hire AS "firstNonHireDate"
           FROM employees e
           JOIN countries c ON c.code = e.country_code
           LEFT JOIN (SELECT employee_id, max(effective_date) AS latest,
                             min(effective_date) FILTER (WHERE change_type <> 'hire') AS first_non_hire
                        FROM employee_changes GROUP BY employee_id) h ON h.employee_id = e.id`,
      );
      const { rows: countries } = await db.query<{ code: string; currencyCode: string }>(
        'SELECT code, currency_code AS "currencyCode" FROM countries',
      );
      return {
        form,
        today,
        employeesByCode: new Map(employees.map((e) => [e.employeeCode, e])),
        employeeCodeByEmail: new Map(employees.map((e) => [e.email, e.employeeCode])),
        currencyByCountry: new Map(countries.map((c) => [c.code, c.currencyCode])),
      };
    },

    /** Moves a validating import to its preview; false if it was cancelled meanwhile. */
    markPreviewReady: async (id: string, counts: object, expiresAt: Date) =>
      (
        await db.query(
          `UPDATE imports SET status = 'awaiting_confirmation', counts = $2, preview_expires_at = $3
            WHERE id = $1 AND status = 'validating'`,
          [id, JSON.stringify(counts), expiresAt],
        )
      ).rowCount === 1,

    /** Replaces the import's rows, so a retried validation never duplicates them. */
    savePreviewRows: async (id: string, results: RowResult[]) => {
      await db.query('DELETE FROM import_rows WHERE import_id = $1', [id]);
      await db.query(
        `INSERT INTO import_rows (import_id, row_number, employee_code, raw, preview_outcome, errors)
         SELECT $1, * FROM unnest($2::int[], $3::text[], $4::jsonb[], $5::text[], $6::jsonb[])`,
        [
          id,
          results.map((r) => r.rowNumber),
          results.map((r) => r.employeeCode),
          results.map((r) => JSON.stringify(r.raw)),
          results.map((r) => r.outcome),
          results.map((r) => JSON.stringify(r.errors)),
        ],
      );
    },

    countries: async () =>
      new Map(
        (
          await db.query<{ code: string; currencyCode: string }>(
            'SELECT code, currency_code AS "currencyCode" FROM countries',
          )
        ).rows.map((c) => [c.code, c.currencyCode]),
      ),

    /**
     * The row rules' context for one row, from current data: locks the employee (if any) until the
     * row's transaction ends, so nothing changes between checking and writing.
     */
    rowContext: async (
      form: ImportForm,
      today: string,
      code: string,
      email: string,
      currencyByCountry: Map<string, string>,
    ): Promise<RowContext> => {
      await db.query('SELECT 1 FROM employees WHERE employee_code = $1 FOR UPDATE', [code]);
      const { rows: employees } = await db.query<ExistingEmployee>(
        `SELECT e.id, e.employee_code AS "employeeCode", e.first_name AS "firstName",
                e.last_name AS "lastName", e.email, e.job_title AS "jobTitle", e.department,
                e.country_code AS "countryCode", c.currency_code AS "currencyCode",
                e.hire_date AS "hireDate", e.base_salary AS "baseSalary", e.allowances,
                e.exit_type AS "exitType", e.notice_date AS "noticeDate",
                e.last_working_day AS "lastWorkingDay", e.version,
                (SELECT max(effective_date) FROM employee_changes WHERE employee_id = e.id)
                  AS "latestEffectiveDate",
                (SELECT min(effective_date) FROM employee_changes
                  WHERE employee_id = e.id AND change_type <> 'hire') AS "firstNonHireDate"
           FROM employees e JOIN countries c ON c.code = e.country_code
          WHERE e.employee_code = $1 OR e.email = $2`,
        [code, email],
      );
      return {
        form,
        today,
        employeesByCode: new Map(
          employees.filter((e) => e.employeeCode === code).map((e) => [e.employeeCode, e]),
        ),
        employeeCodeByEmail: new Map(employees.map((e) => [e.email, e.employeeCode])),
        currencyByCountry,
      };
    },

    /** Rows not yet applied, in file order; finished rows are skipped on a retry (D-020). */
    pendingRows: async (id: string) =>
      (
        await db.query<{
          rowNumber: number;
          raw: Record<string, string>;
          previewOutcome: string;
          errors: string[];
        }>(
          `SELECT row_number AS "rowNumber", raw, preview_outcome AS "previewOutcome", errors
             FROM import_rows
            WHERE import_id = $1 AND applied_at IS NULL
            ORDER BY row_number`,
          [id],
        )
      ).rows,

    recordOutcome: async (
      id: string,
      rowNumber: number,
      outcome: string,
      errors: string[],
      now: Date,
    ) => {
      await db.query(
        `UPDATE import_rows SET outcome = $3, errors = $4, applied_at = $5
          WHERE import_id = $1 AND row_number = $2`,
        [id, rowNumber, outcome, JSON.stringify(errors), now],
      );
    },

    /** Final counts from each row's outcome, merged into the preview counts. */
    complete: async (id: string, now: Date) => {
      await db.query(
        `UPDATE imports
            SET status = 'completed', finished_at = $2,
                counts = coalesce(counts, '{}') || (
                  SELECT jsonb_build_object(
                    'created', count(*) FILTER (WHERE outcome = 'created'),
                    'updated', count(*) FILTER (WHERE outcome = 'updated'),
                    'unchanged', count(*) FILTER (WHERE outcome = 'unchanged'),
                    'rejected', count(*) FILTER (WHERE outcome = 'rejected'))
                    FROM import_rows WHERE import_id = $1)
          WHERE id = $1 AND status = 'applying'`,
        [id, now],
      );
    },

    /** Moves an import from one of `from` to `to`; false if it was in another state. */
    transition: async (
      id: string,
      from: string[],
      to: string,
      now: Date,
      extra: { confirmedBy?: string; finished?: boolean } = {},
    ) =>
      (
        await db.query(
          `UPDATE imports
              SET status = $3,
                  confirmed_by = coalesce($5, confirmed_by),
                  finished_at = CASE WHEN $6 THEN $4 ELSE finished_at END
            WHERE id = $1 AND status = ANY($2::text[])`,
          [id, from, to, now, extra.confirmedBy ?? null, extra.finished ?? false],
        )
      ).rowCount === 1,

    activeImportId: async () =>
      (
        await db.query<{ id: string }>(
          `SELECT id FROM imports WHERE status IN ('validating', 'awaiting_confirmation', 'applying')`,
        )
      ).rows[0]?.id ?? null,
  };
}

export type ImportRepos = ReturnType<typeof importRepositories>;
