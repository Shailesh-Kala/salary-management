import { z } from 'zod';
import { CHANGE_TYPES } from '../employees/employee.schemas.ts';
import { countryCode, isoDate } from '../../shared/employee-rules.ts';
import { currencyCode } from '../rates/rates.schemas.ts';

export const insightsQuery = z.object({
  country: countryCode.optional(),
  department: z.string().trim().min(1).max(100).optional(),
  currency: currencyCode.default('INR'),
});

export type InsightsQuery = z.infer<typeof insightsQuery>;

const department = z.string().trim().min(1).max(100).optional();

export const jobTitleQuery = z.object({ country: countryCode, department });

export type JobTitleQuery = z.infer<typeof jobTitleQuery>;

export const outliersQuery = z.object({
  // Flag pay below `low` × or above `high` × the peer median.
  low: z.coerce.number().gt(0).max(1).default(0.8),
  high: z.coerce.number().min(1).max(10).default(1.2),
  country: countryCode.optional(),
  department,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type OutliersQuery = z.infer<typeof outliersQuery>;

export const recentChangesQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  changeType: z.enum(CHANGE_TYPES).optional(),
  country: countryCode.optional(),
  department,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type RecentChangesQuery = z.infer<typeof recentChangesQuery>;
