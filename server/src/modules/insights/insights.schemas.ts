import { z } from 'zod';
import { countryCode } from '../employees/employee.schemas.ts';
import { currencyCode } from '../rates/rates.schemas.ts';

export const insightsQuery = z.object({
  country: countryCode.optional(),
  department: z.string().trim().min(1).max(100).optional(),
  currency: currencyCode.default('INR'),
});

export type InsightsQuery = z.infer<typeof insightsQuery>;
