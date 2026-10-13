import type { Pool, PoolClient } from 'pg';
import type { CurrentRate, RateChange } from './rates.ts';
import type { RateHistoryQuery, UpdateRateInput } from './rates.schemas.ts';

const USER_REF = (alias: string) =>
  `CASE WHEN ${alias}.id IS NULL THEN NULL ELSE json_build_object('id', ${alias}.id, 'name', ${alias}.name) END`;

const RATE_COLUMNS = `r.currency_code AS "currencyCode", r.inr_per_unit AS "inrPerUnit",
  r.as_of AS "asOf", ${USER_REF('u')} AS "updatedBy", r.updated_at AS "updatedAt"`;

export function rateRepositories(db: Pool | PoolClient) {
  return {
    /** Oldest rate date (conversions are only as fresh as it) and whether `currency` exists. */
    ratesInfo: async (currency: string) =>
      (
        await db.query<{ asOf: string; known: boolean }>(
          `SELECT min(as_of) AS "asOf", coalesce(bool_or(currency_code = $1), false) AS known
             FROM exchange_rates`,
          [currency],
        )
      ).rows[0]!,

    countries: async () =>
      (
        await db.query(
          'SELECT code, name, currency_code AS "currencyCode" FROM countries ORDER BY name',
        )
      ).rows,

    list: async () =>
      (
        await db.query(
          `SELECT ${RATE_COLUMNS} FROM exchange_rates r LEFT JOIN hr_users u ON u.id = r.updated_by
            ORDER BY r.currency_code`,
        )
      ).rows,

    /** Locks the rate so concurrent edits are applied (and audited) one after the other. */
    findForUpdate: async (currency: string) =>
      (
        await db.query<CurrentRate>(
          `SELECT currency_code AS "currencyCode", inr_per_unit AS "inrPerUnit", as_of AS "asOf"
             FROM exchange_rates WHERE currency_code = $1 FOR UPDATE`,
          [currency],
        )
      ).rows[0] ?? null,

    update: async (currency: string, input: UpdateRateInput, actorId: string, now: Date) =>
      (
        await db.query(
          `WITH r AS (
             UPDATE exchange_rates
                SET inr_per_unit = $2, as_of = $3, updated_by = $4, updated_at = $5
              WHERE currency_code = $1
              RETURNING *)
           SELECT ${RATE_COLUMNS} FROM r LEFT JOIN hr_users u ON u.id = r.updated_by`,
          [currency, input.inrPerUnit, input.asOf, actorId, now],
        )
      ).rows[0],

    recordChange: async (currency: string, change: RateChange, actorId: string, now: Date) => {
      await db.query(
        `INSERT INTO exchange_rate_changes (currency_code, old_inr_per_unit, new_inr_per_unit,
           old_as_of, new_as_of, changed_by, changed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          currency,
          change.oldInrPerUnit,
          change.newInrPerUnit,
          change.oldAsOf,
          change.newAsOf,
          actorId,
          now,
        ],
      );
    },

    history: async ({ currency, page, pageSize }: RateHistoryQuery) => {
      const where = currency ? 'WHERE h.currency_code = $1' : '';
      const filter = currency ? [currency] : [];
      const { rows: items } = await db.query(
        `SELECT h.id::text AS id, h.currency_code AS "currencyCode",
                h.old_inr_per_unit AS "oldInrPerUnit", h.new_inr_per_unit AS "newInrPerUnit",
                h.old_as_of AS "oldAsOf", h.new_as_of AS "newAsOf",
                ${USER_REF('u')} AS "changedBy", h.changed_at AS "changedAt"
           FROM exchange_rate_changes h JOIN hr_users u ON u.id = h.changed_by
           ${where}
          ORDER BY h.changed_at DESC, h.id DESC
          LIMIT $${filter.length + 1} OFFSET $${filter.length + 2}`,
        [...filter, pageSize, (page - 1) * pageSize],
      );
      const { rows } = await db.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM exchange_rate_changes h ${where}`,
        filter,
      );
      return { items, total: rows[0]!.total };
    },
  };
}

export type RateRepos = ReturnType<typeof rateRepositories>;
