import type { Pool, QueryResultRow } from 'pg';
import type { InsightsQuery } from './insights.schemas.ts';

/**
 * Current headcount (active and on notice) with each annual salary (base + allowances) in local
 * currency and converted to the reporting currency. Rounding happens only on the final figures.
 */
function currentPay(f: InsightsQuery, today: string) {
  const params: unknown[] = [];
  const p = (value: unknown) => `$${params.push(value)}`;
  const where = [
    `rt.currency_code = ${p(f.currency)}`,
    `(e.last_working_day IS NULL OR e.last_working_day >= ${p(today)})`,
  ];
  if (f.country) where.push(`e.country_code = ${p(f.country)}`);
  if (f.department) where.push(`e.department = ${p(f.department)}`);

  const sql = `SELECT e.country_code, c.name AS country_name, c.currency_code AS local_currency,
      e.department,
      e.base_salary + e.allowances AS annual,
      (e.base_salary + e.allowances) * rf.inr_per_unit / rt.inr_per_unit AS converted
    FROM employees e
    JOIN countries c ON c.code = e.country_code
    JOIN exchange_rates rf ON rf.currency_code = c.currency_code
    CROSS JOIN exchange_rates rt
    WHERE ${where.join(' AND ')}`;
  return { sql, params };
}

const median = (column: string) =>
  `round((percentile_cont(0.5) WITHIN GROUP (ORDER BY ${column}))::numeric, 2)`;

// Amounts as text so money never passes through a JS float.
const statsJson = (column: string) => `json_build_object(
  'min', round(min(${column}), 2)::text,
  'median', ${median(column)}::text,
  'average', round(avg(${column}), 2)::text,
  'max', round(max(${column}), 2)::text,
  'total', round(sum(${column}), 2)::text)`;

export function insightRepositories(db: Pool) {
  const query = async <T extends QueryResultRow>(
    f: InsightsQuery,
    today: string,
    select: (pay: string) => string,
  ) => {
    const base = currentPay(f, today);
    return (await db.query<T>(`WITH pay AS (${base.sql}) ${select('pay')}`, base.params)).rows;
  };

  return {
    /** Q1: headcount and payroll totals. */
    summary: async (f: InsightsQuery, today: string) =>
      (
        await query<{
          headcount: number;
          totalPayroll: string;
          averageSalary: string | null;
          medianSalary: string | null;
        }>(
          f,
          today,
          (pay) => `SELECT count(*)::int AS headcount,
                           round(coalesce(sum(converted), 0), 2) AS "totalPayroll",
                           round(avg(converted), 2) AS "averageSalary",
                           ${median('converted')} AS "medianSalary"
                      FROM ${pay}`,
        )
      )[0]!,

    /** Q2: pay spread per country, in local and reporting currency. */
    byCountry: (f: InsightsQuery, today: string) =>
      query(
        f,
        today,
        (pay) => `SELECT country_code AS "countryCode", country_name AS "countryName",
                         local_currency AS "currencyCode", count(*)::int AS headcount,
                         ${statsJson('annual')} AS local,
                         ${statsJson('converted')} AS converted
                    FROM ${pay}
                   GROUP BY country_code, country_name, local_currency
                   ORDER BY country_name`,
      ),

    /** Q3: departments ranked by what they cost. */
    byDepartment: (f: InsightsQuery, today: string) =>
      query(
        f,
        today,
        (pay) => `SELECT department, count(*)::int AS headcount,
                         round(sum(converted), 2) AS "totalPayroll",
                         ${median('converted')} AS "medianSalary",
                         round(avg(converted), 2) AS "averageSalary"
                    FROM ${pay}
                   GROUP BY department
                   ORDER BY sum(converted) DESC, department`,
      ),
  };
}

export type InsightRepos = ReturnType<typeof insightRepositories>;
