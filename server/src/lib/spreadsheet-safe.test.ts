import { describe, expect, it } from 'vitest';
import { spreadsheetSafe } from './spreadsheet-safe.ts';

describe('spreadsheetSafe', () => {
  it.each(['=SUM(A1:A9)', '+1', '-1', '@cmd', '\tTAB', '\rCR'])(
    'prefixes %j with an apostrophe so spreadsheets show it as text',
    (value) => {
      expect(spreadsheetSafe(value)).toBe(`'${value}`);
    },
  );

  it.each(['Asha', 'O’Brien', '1800000.00', '', 'a=b'])('leaves %j unchanged', (value) => {
    expect(spreadsheetSafe(value)).toBe(value);
  });
});
