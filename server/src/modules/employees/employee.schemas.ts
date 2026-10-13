import { z } from 'zod';
import { nonNegativeAmount, positiveAmount } from '../../lib/money.ts';

const text = z.string().trim().min(1).max(100);

/** 'YYYY-MM-DD' that is a real calendar date; kept as a string (D-039). */
export const isoDate = z.iso.date();

export const note = z.string().trim().min(5).max(1000);

export const countryCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'Use a two-letter country code');

export const createEmployeeSchema = z.strictObject({
  employeeCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{1,20}$/, 'Use letters, digits, - or _ (max 20)'),
  firstName: text,
  lastName: text,
  email: z.string().trim().toLowerCase().pipe(z.email()),
  jobTitle: text,
  department: text,
  countryCode,
  hireDate: isoDate,
  baseSalary: positiveAmount,
  allowances: nonNegativeAmount.default('0'),
  note: note.optional(),
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

export const SORT_FIELDS = [
  'name',
  'employeeCode',
  'jobTitle',
  'department',
  'country',
  'hireDate',
  'annualSalary',
] as const;

export const listEmployeesQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(SORT_FIELDS).default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
  q: z.string().trim().max(100).optional(),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  department: text.optional(),
  jobTitle: text.optional(),
  status: z.enum(['active', 'on_notice', 'exited']).optional(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .default('INR'),
});

export type ListEmployeesQuery = z.infer<typeof listEmployeesQuery>;

/** Only fields that aren't audited; salary, title, department, country and dates need a change event. */
export const updateProfileSchema = z
  .strictObject({
    version: z.int().min(1),
    firstName: text.optional(),
    lastName: text.optional(),
    email: z.string().trim().toLowerCase().pipe(z.email()).optional(),
  })
  .refine((p) => p.firstName ?? p.lastName ?? p.email, 'Nothing to update');

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** Change types HR can record; hire and exit types are written by their own flows. */
export const CHANGE_TYPES = [
  'annual_review',
  'promotion',
  'market_adjustment',
  'relocation',
  'correction',
  'other',
] as const;

export const changeEventSchema = z.strictObject({
  version: z.int().min(1),
  changeType: z.enum(CHANGE_TYPES),
  effectiveDate: isoDate,
  note,
  baseSalary: positiveAmount.optional(),
  allowances: nonNegativeAmount.optional(),
  jobTitle: text.optional(),
  department: text.optional(),
  countryCode: countryCode.optional(),
  hireDate: isoDate.optional(),
});

export type ChangeEventInput = z.infer<typeof changeEventSchema>;

export const exitSchema = z.strictObject({
  version: z.int().min(1),
  exitType: z.enum(['resigned', 'terminated']),
  noticeDate: isoDate,
  lastWorkingDay: isoDate,
  note,
});

export type ExitInput = z.infer<typeof exitSchema>;

export const withdrawExitSchema = z.strictObject({ version: z.int().min(1), note });

export type WithdrawExitInput = z.infer<typeof withdrawExitSchema>;
