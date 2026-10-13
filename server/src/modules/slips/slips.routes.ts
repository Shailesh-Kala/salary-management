import { Router } from 'express';
import { z } from 'zod';
import { employeeId } from '../employees/employees.routes.ts';
import type { SlipsService } from './slips.service.ts';

const slipParams = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month like 2026-09'),
});

export function slipRoutes(slips: SlipsService) {
  const routes = Router();

  routes.get('/employees/:id/slips/:month', async (req, res) => {
    const id = employeeId(req);
    const { month } = slipParams.parse({ month: req.params.month });
    res.json(await slips.get(id, month));
  });

  return routes;
}
