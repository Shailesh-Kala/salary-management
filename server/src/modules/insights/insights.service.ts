import type { Clock } from '../../lib/clock.ts';
import { invalidField } from '../../lib/errors.ts';
import type { RateRepos } from '../rates/rates.repository.ts';
import type { InsightRepos } from './insights.repository.ts';
import type { InsightsQuery } from './insights.schemas.ts';

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
  };
}

export type InsightsService = ReturnType<typeof createInsightsService>;
