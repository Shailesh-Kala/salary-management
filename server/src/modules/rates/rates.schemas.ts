import { z } from 'zod';
import { isoDate } from '../../shared/employee-rules.ts';

// Fits NUMERIC(18,6): plain decimal, up to 6 places.
const PLAIN_RATE = /^\d{1,12}(\.\d{1,6})?$/;

export const updateRateSchema = z.strictObject({
  inrPerUnit: z
    .union([z.string().trim(), z.number()])
    .transform(String)
    .pipe(z.string().regex(PLAIN_RATE, 'Use a rate like 88.75 (up to 6 decimals)'))
    .pipe(z.string().refine((rate) => Number(rate) > 0, 'Must be greater than 0')),
  asOf: isoDate,
});

export type UpdateRateInput = z.infer<typeof updateRateSchema>;

export const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Use a three-letter currency code, like USD');

export const rateHistoryQuery = z.object({
  currency: currencyCode.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type RateHistoryQuery = z.infer<typeof rateHistoryQuery>;
