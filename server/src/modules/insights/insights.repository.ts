import type { Pool, QueryResultRow } from 'pg';
import type { InsightsQuery, JobTitleQuery, OutliersQuery } from './insights.schemas.ts';

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

    countryCurrency: async (code: string) =>
      (
        await db.query<{ currencyCode: string }>(
          'SELECT currency_code AS "currencyCode" FROM countries WHERE code = $1',
          [code],
        )
      ).rows[0]?.currencyCode ?? null,

    /** Q4: pay range per job title within one country, in that country's currency. */
    byJobTitle: async ({ country, department }: JobTitleQuery, today: string) => {
      const params: unknown[] = [country, today];
      const byDepartment = department ? `AND department = $${params.push(department)}` : '';
      const { rows } = await db.query(
        `SELECT job_title AS "jobTitle", count(*)::int AS headcount,
                round(min(annual), 2) AS min, ${median('annual')} AS median,
                round(max(annual), 2) AS max
           FROM (SELECT job_title, department, base_salary + allowances AS annual
                   FROM employees
                  WHERE country_code = $1
                    AND (last_working_day IS NULL OR last_working_day >= $2)) pay
          WHERE true ${byDepartment}
          GROUP BY job_title
          ORDER BY job_title`,
        params,
      );
      return rows;
    },

    /**
     * Q5: employees paid outside low–high × the median of their peers (same job title and
     * country). Medians use all current staff; filters only narrow who is listed.
     */
    outliers: async (q: OutliersQuery, today: string) => {
      const params: unknown[] = [today, q.low, q.high];
      const filters = [
        q.country && `country_code = $${params.push(q.country)}`,
        q.department && `department = $${params.push(q.department)}`,
      ].filter(Boolean);
      const flagged = `WITH pay AS (
          SELECT e.id, e.employee_code, e.first_name, e.last_name, e.job_title, e.department,
                 e.country_code, c.currency_code, e.base_salary + e.allowances AS annual
            FROM employees e JOIN countries c ON c.code = e.country_code
           WHERE e.last_working_day IS NULL OR e.last_working_day >= $1),
        peers AS (
          SELECT job_title, country_code, count(*)::int AS peer_count,
                 (percentile_cont(0.5) WITHIN GROUP (ORDER BY annual))::numeric AS median
            FROM pay GROUP BY job_title, country_code),
        flagged AS (
          SELECT pay.*, peers.median, peers.peer_count, pay.annual / peers.median AS ratio
            FROM pay JOIN peers USING (job_title, country_code)
           WHERE (pay.annual < $2::numeric * peers.median OR pay.annual > $3::numeric * peers.median)
             ${filters.map((f) => `AND ${f}`).join(' ')})`;
      const countParams = [...params];

      const { rows: items } = await db.query(
        `${flagged}
         SELECT id, employee_code AS "employeeCode", first_name AS "firstName",
                last_name AS "lastName", job_title AS "jobTitle", department,
                country_code AS "countryCode", currency_code AS "currencyCode",
                annual AS "annualSalary", round(median, 2) AS "peerMedian",
                peer_count AS "peerCount", round(ratio, 2) AS ratio,
                CASE WHEN ratio < 1 THEN 'below' ELSE 'above' END AS position
           FROM flagged
          -- Most extreme first: 2× and ½× the median are equally far out.
          ORDER BY greatest(annual / median, median / annual) DESC, employee_code
          LIMIT $${params.push(q.pageSize)} OFFSET $${params.push((q.page - 1) * q.pageSize)}`,
        params,
      );
      const { rows } = await db.query<{ total: number }>(
        `${flagged} SELECT count(*)::int AS total FROM flagged`,
        countParams,
      );
      return { items, total: rows[0]!.total };
    },

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
