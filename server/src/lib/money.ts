import { z } from 'zod';

// Plain decimal that fits NUMERIC(14,2): no sign, symbols, separators or exponents.
const PLAIN_AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;

/** Amounts stay decimal strings end to end; arithmetic is done in integer cents. */
export const nonNegativeAmount = z
  .union([z.string().trim(), z.number()])
  .transform(String)
  .pipe(z.string().regex(PLAIN_AMOUNT, 'Must be an amount like 95000 or 95000.50'));

// pipe (not refine) so a malformed amount reports one error, not "malformed" and "not > 0".
export const positiveAmount = nonNegativeAmount.pipe(
  z.string().refine((amount) => toCents(amount) > 0, 'Must be greater than 0'),
);

// Safe as Number: the largest NUMERIC(14,2) value is ~1e14 cents, well below 2^53.
function toCents(amount: string): number {
  const [whole, fraction = ''] = amount.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

function fromCents(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/** Annual ÷ 12, rounded half-up to the cent. */
export function annualToMonthly(annual: string): string {
  const cents = toCents(annual);
  const quotient = Math.floor(cents / 12);
  const remainder = cents % 12;
  return fromCents(remainder * 2 >= 12 ? quotient + 1 : quotient);
}
