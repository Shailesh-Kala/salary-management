import { describe, expect, it } from 'vitest';
import { annualToMonthly } from './money.ts';

describe('annualToMonthly', () => {
  it.each([
    ['120000', '10000.00'],
    ['100000', '8333.33'],
    ['100000.06', '8333.34'],
    ['0.06', '0.01'], // exactly half a cent rounds up
    ['0.05', '0.00'],
    ['999999999999.99', '83333333333.33'],
  ])('splits %s a year into %s a month (half-up to the cent)', (annual, monthly) => {
    expect(annualToMonthly(annual)).toBe(monthly);
  });
});
