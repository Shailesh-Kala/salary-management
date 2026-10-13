import { describe, expect, it } from 'vitest';
import { planRateChange } from './rates.ts';
import { updateRateSchema } from './rates.schemas.ts';

const usd = { currencyCode: 'USD', inrPerUnit: '88.750000', asOf: '2026-10-01' };
const TODAY = '2026-10-12';

const rejection = (path: string, message: string) =>
  expect.objectContaining({ code: 'VALIDATION_ERROR', details: [{ path, message }] });

describe('planRateChange', () => {
  it('records old and new rate and date', () => {
    expect(planRateChange(usd, { inrPerUnit: '90', asOf: '2026-10-12' }, TODAY)).toEqual({
      oldInrPerUnit: '88.750000',
      newInrPerUnit: '90',
      oldAsOf: '2026-10-01',
      newAsOf: '2026-10-12',
    });
  });

  it('keeps INR fixed at 1', () => {
    const inr = { currencyCode: 'INR', inrPerUnit: '1.000000', asOf: '2026-10-01' };

    expect(() => planRateChange(inr, { inrPerUnit: '2', asOf: TODAY }, TODAY)).toThrow(
      rejection('currency', 'INR is the base currency and is always 1'),
    );
  });

  it('rejects an as-of date in the future', () => {
    expect(() => planRateChange(usd, { inrPerUnit: '90', asOf: '2026-10-13' }, TODAY)).toThrow(
      rejection('asOf', 'Rate date cannot be in the future'),
    );
  });

  it('rejects an update that changes nothing, however the rate is written', () => {
    expect(() => planRateChange(usd, { inrPerUnit: '88.75', asOf: '2026-10-01' }, TODAY)).toThrow(
      rejection('', 'Nothing changed: enter a new rate or date'),
    );
  });
});

describe('updateRateSchema', () => {
  it.each([
    ['zero', '0'],
    ['negative', '-1'],
    ['more than 6 decimals', '88.1234567'],
    ['text', 'abc'],
  ])('rejects a rate that is %s', (_case, inrPerUnit) => {
    expect(updateRateSchema.safeParse({ inrPerUnit, asOf: TODAY }).success).toBe(false);
  });

  it('accepts up to 6 decimals, as a string or number', () => {
    expect(updateRateSchema.parse({ inrPerUnit: 88.123456, asOf: TODAY })).toEqual({
      inrPerUnit: '88.123456',
      asOf: TODAY,
    });
  });
});
