import { Router } from 'express';
import { z } from 'zod';
import { employeeId } from '../employees/employees.routes.ts';
import type { SlipsService } from './slips.service.ts';

const slipParams = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month like 2026-09'),
});

const slipQuery = z.object({ format: z.enum(['json', 'pdf']).default('json') });

export function slipRoutes(slips: SlipsService) {
  const routes = Router();

  routes.get('/employees/:id/slips/:month', async (req, res) => {
    const id = employeeId(req);
    const { month } = slipParams.parse({ month: req.params.month });
    const { format } = slipQuery.parse(req.query);
    if (format === 'json') {
      res.json(await slips.get(id, month));
      return;
    }
    const { filename, content } = await slips.pdf(id, month);
    // Employee codes are [A-Z0-9_-] only, so the filename needs no escaping.
    res
      .type('application/pdf')
      .set('Content-Disposition', `attachment; filename="${filename}"`)
      .send(content);
  });

  return routes;
}
