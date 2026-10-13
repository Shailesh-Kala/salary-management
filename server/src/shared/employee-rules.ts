import { z } from 'zod';
import './zod-messages.ts';

// Everything in src/shared is also bundled into the web app (through the `@shared` alias), so it
// may import nothing but zod and other files in this folder. That is checked by a test.

export const NOTE_MIN_LENGTH = 5;
export const NOTE_MAX_LENGTH = 1000;
const MAX_TEXT = 100;

/** Says `message` when the field is absent; any other failure keeps the standard wording. */
const whenMissing = (message: string) => (issue: { input?: unknown }) =>
  issue.input === undefined ? message : undefined;

/** Required text that must not be blank. */
const required = (message: string) =>
  z
    .string({ error: whenMissing(message) })
    .trim()
    .min(1, message)
    .max(MAX_TEXT);

/** Optional text in filters and edits: 1–100 characters when present. */
export const text = z.string().trim().min(1).max(MAX_TEXT);

/** 'YYYY-MM-DD' that is a real calendar date; kept as a string (D-039). */
export const isoDate = z.iso.date();

export const note = z.string().trim().min(NOTE_MIN_LENGTH).max(NOTE_MAX_LENGTH);

export const countryCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'Use a two-letter country code');

// Plain decimal that fits NUMERIC(14,2): no sign, symbols, separators or exponents.
const PLAIN_AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;
const AMOUNT_MESSAGE =
  'Enter a plain number like 95000 or 95000.50, with no commas or currency symbols';

/** Amounts stay decimal strings end to end; arithmetic is done in integer cents. */
const amount = (missing?: string) =>
  z
    .union([z.string().trim(), z.number()], missing ? { error: whenMissing(missing) } : {})
    .transform(String)
    .pipe(z.string().regex(PLAIN_AMOUNT, AMOUNT_MESSAGE));

// pipe (not refine) so a malformed amount reports one error, not "malformed" and "not > 0".
// A matching amount is positive when it has any digit from 1 to 9.
const positive = (missing?: string) =>
  amount(missing).pipe(z.string().refine((value) => /[1-9]/.test(value), 'Must be greater than 0'));

export const nonNegativeAmount = amount();
export const positiveAmount = positive();

export const createEmployeeSchema = z.strictObject({
  employeeCode: z
    .string({ error: whenMissing('Enter an employee code, like EMP-00001') })
    .trim()
    .toUpperCase()
    .min(1, { error: 'Enter an employee code, like EMP-00001', abort: true })
    .regex(/^[A-Z0-9_-]{1,20}$/, 'Use only letters, digits, - or _ (up to 20 characters)'),
  firstName: required('Enter the first name'),
  lastName: required('Enter the last name'),
  email: z
    .string({ error: whenMissing('Enter the work email') })
    .trim()
    .toLowerCase()
    .min(1, { error: 'Enter the work email', abort: true })
    .pipe(z.email()),
  jobTitle: required('Enter the job title'),
  department: required('Enter the department'),
  countryCode: z.string({ error: whenMissing('Choose a country') }).pipe(countryCode),
  hireDate: z.iso.date({ error: whenMissing('Choose the hire date') }),
  baseSalary: positive('Enter the annual base salary'),
  allowances: nonNegativeAmount.default('0'),
  note: note.optional(),
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
