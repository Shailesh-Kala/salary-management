import { describe, expect, it } from 'vitest';
import { pdfAmount } from './pdf.ts';

describe('pdfAmount', () => {
  it('groups INR the Indian way', () => {
    expect(pdfAmount('463108.33', 'INR')).toBe('INR 4,63,108.33');
  });

  it.each(['USD', 'EUR', 'SGD'])('groups %s internationally', (currency) => {
    expect(pdfAmount('108764.96', currency)).toBe(`${currency} 108,764.96`);
    expect(pdfAmount('1234567.89', currency)).toBe(`${currency} 1,234,567.89`);
  });
});
