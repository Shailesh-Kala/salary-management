import { Router } from 'express';
import { AppError } from '../../lib/errors.ts';
import { currencyCode, rateHistoryQuery, updateRateSchema } from './rates.schemas.ts';
import type { RatesService } from './rates.service.ts';

export function rateRoutes(rates: RatesService) {
  const routes = Router();

  routes.get('/countries', async (_req, res) => {
    res.json(await rates.countries());
  });

  routes.get('/exchange-rates', async (_req, res) => {
    res.json(await rates.list());
  });

  routes.get('/exchange-rates/history', async (req, res) => {
    res.json(await rates.history(rateHistoryQuery.parse(req.query)));
  });

  routes.put('/exchange-rates/:currency', async (req, res) => {
    const currency = currencyCode.safeParse(req.params.currency);
    if (!currency.success) throw new AppError('NOT_FOUND', 404, 'Unknown currency');
    const input = updateRateSchema.parse(req.body);
    res.json(await rates.updateRate(currency.data, input, req.user!));
  });

  return routes;
}
