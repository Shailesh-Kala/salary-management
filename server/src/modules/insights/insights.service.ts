import type { Clock } from '../../lib/clock.ts';
import { addDays } from '../../lib/dates.ts';
import { invalidField } from '../../lib/errors.ts';
import type { RateRepos } from '../rates/rates.repository.ts';
import type { InsightRepos } from './insights.repository.ts';
import type {
  InsightsQuery,
  JobTitleQuery,
  OutliersQuery,
  RecentChangesQuery,
} from './insights.schemas.ts';

export type InsightsServiceDeps = {
  clock: Clock;
  repos: InsightRepos;
  rates: Pick<RateRepos, 'ratesInfo'>;
};

export function createInsightsService({ clock, repos, rates }: InsightsServiceDeps) {
  /** Checks the currency and adds it and the rates date to every answer. */
  const answer = async <T extends object>(query: InsightsQuery, compute: () => Promise<T>) => {
    const info = await rates.ratesInfo(query.currency);
    if (!info.known) throw invalidField('currency', 'Unknown currency');
    return { currency: query.currency, ratesAsOf: info.asOf, ...(await compute()) };
  };

  return {
    summary: (q: InsightsQuery) => answer(q, () => repos.summary(q, clock.today())),
    byCountry: (q: InsightsQuery) =>
      answer(q, async () => ({ items: await repos.byCountry(q, clock.today()) })),
    byDepartment: (q: InsightsQuery) =>
      answer(q, async () => ({ items: await repos.byDepartment(q, clock.today()) })),

    async byJobTitle(q: JobTitleQuery) {
      const currencyCode = await repos.countryCurrency(q.country);
      if (!currencyCode) throw invalidField('country', 'Unsupported country');
      return { country: q.country, currencyCode, items: await repos.byJobTitle(q, clock.today()) };
    },

    /** Defaults to the last 90 days. */
    async recentChanges(q: RecentChangesQuery) {
      const to = q.to ?? clock.today();
      const from = q.from ?? addDays(to, -90);
      if (from > to) throw invalidField('from', 'Start date must be on or before the end date');
      return {
        from,
        to,
        ...(await repos.recentChanges({ ...q, from, to })),
        page: q.page,
        pageSize: q.pageSize,
      };
    },

    leavers: (q: InsightsQuery) => answer(q, () => repos.leavers(q, clock.today())),

    outliers: async (q: OutliersQuery) => ({
      low: q.low,
      high: q.high,
      ...(await repos.outliers(q, clock.today())),
      page: q.page,
      pageSize: q.pageSize,
    }),
  };
}

export type InsightsService = ReturnType<typeof createInsightsService>;
