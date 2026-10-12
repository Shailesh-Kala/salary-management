import { describe, expect, it } from 'vitest';
import { annualToMonthly, nonNegativeAmount, positiveAmount } from './money.ts';

describe('positiveAmount', () => {
  it.each([
    ['95000', '95000'],
    ['95000.5', '95000.5'],
    [' 95000.50 ', '95000.50'],
    [95000, '95000'],
    [0.01, '0.01'],
    ['999999999999.99', '999999999999.99'],
  ])('accepts %j as %j', (input, expected) => {
    expect(positiveAmount.parse(input)).toBe(expected);
  });

  it.each([
    ['zero', '0'],
    ['zero with decimals', '0.00'],
    ['negative', '-1'],
    ['thousands separator', '95,000'],
    ['currency symbol', '$95000'],
    ['three decimals', '95000.123'],
    ['exponent', '1e5'],
    ['exponent number', 1e-7],
    ['empty', ''],
    ['text', 'abc'],
    ['over NUMERIC(14,2)', '1000000000000'],
    ['not a number', Number.NaN],
  ])('rejects %s', (_case, input) => {
    expect(positiveAmount.safeParse(input).success).toBe(false);
  });
});

describe('nonNegativeAmount', () => {
  it('accepts zero but not negatives', () => {
    expect(nonNegativeAmount.parse('0')).toBe('0');
    expect(nonNegativeAmount.safeParse('-0.01').success).toBe(false);
  });
});

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
