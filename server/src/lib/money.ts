// Safe as Number: the largest NUMERIC(14,2) value is ~1e14 cents, well below 2^53.
function toCents(amount: string): number {
  const [whole, fraction = ''] = amount.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/** True when two amounts are equal however they are written ('1800000' vs '1800000.00'). */
export const sameAmount = (a: string, b: string) => toCents(a) === toCents(b);

function fromCents(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export const addAmounts = (a: string, b: string) => fromCents(toCents(a) + toCents(b));

/** Annual ÷ 12, rounded half-up to the cent. */
export function annualToMonthly(annual: string): string {
  const cents = toCents(annual);
  const quotient = Math.floor(cents / 12);
  const remainder = cents % 12;
  return fromCents(remainder * 2 >= 12 ? quotient + 1 : quotient);
}
