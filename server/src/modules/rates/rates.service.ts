import type { Clock } from '../../lib/clock.ts';
import { AppError } from '../../lib/errors.ts';
import type { AuthUser } from '../auth/auth.service.ts';
import { planRateChange } from './rates.ts';
import type { RateRepos } from './rates.repository.ts';
import type { RateHistoryQuery, UpdateRateInput } from './rates.schemas.ts';

export type RatesServiceDeps = {
  clock: Clock;
  repos: RateRepos;
  inTransaction: <T>(fn: (repos: RateRepos) => Promise<T>) => Promise<T>;
};

export function createRatesService({ clock, repos, inTransaction }: RatesServiceDeps) {
  return {
    countries: async () => ({ items: await repos.countries() }),

    list: async () => ({ items: await repos.list() }),

    history: async (query: RateHistoryQuery) => ({
      ...(await repos.history(query)),
      page: query.page,
      pageSize: query.pageSize,
    }),

    /** Updates the rate and appends the old → new values to the rate history, atomically (D-034). */
    updateRate: (currency: string, input: UpdateRateInput, actor: AuthUser) =>
      inTransaction(async (r) => {
        const current = await r.findForUpdate(currency);
        if (!current) throw new AppError('NOT_FOUND', 404, 'Unknown currency');
        const change = planRateChange(current, input, clock.today());
        const updated = await r.update(currency, input, actor.id, clock.now());
        await r.recordChange(currency, change, actor.id, clock.now());
        return updated;
      }),
  };
}

export type RatesService = ReturnType<typeof createRatesService>;
