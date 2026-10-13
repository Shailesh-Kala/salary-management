import { describe, expect, it } from 'vitest';
import { formatMoney } from './format.ts';

describe('formatMoney', () => {
  it('groups INR the Indian way (lakhs and crores)', () => {
    expect(formatMoney('1234567.89', 'INR')).toBe('₹12,34,567.89');
    expect(formatMoney('63803716300', 'INR')).toBe('₹63,80,37,16,300.00');
  });

  it.each([
    ['USD', '$1,234,567.89'],
    ['EUR', '€1,234,567.89'],
    ['GBP', '£1,234,567.89'],
    ['SGD', 'SGD 1,234,567.89'],
  ])('groups %s internationally, in thousands', (currency, expected) => {
    expect(formatMoney('1234567.89', currency).replace(/ /g, ' ')).toBe(expected);
  });
});
