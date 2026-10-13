import { describe, expect, it } from 'vitest';
import { checkUpload, importFormSchema, TEMPLATE_HEADER } from './upload.ts';

const HEADER = TEMPLATE_HEADER.join(',');
const ROW =
  'EMP-1,Asha,Verma,asha@acme.com,Software Engineer,Engineering,IN,2024-04-01,1800000,200000';
const csv = (...lines: string[]) => Buffer.from(lines.join('\n'));
const file = (content: Buffer, name = 'employees.csv') => ({ originalname: name, buffer: content });

const rejection = (path: string, message: string | RegExp) =>
  expect.objectContaining({
    code: 'VALIDATION_ERROR',
    details: [
      { path, message: typeof message === 'string' ? message : expect.stringMatching(message) },
    ],
  });

describe('checkUpload', () => {
  it('accepts a template-shaped CSV and counts its data rows', () => {
    expect(checkUpload(file(csv(HEADER, ROW, ROW.replace('EMP-1', 'EMP-2'))))).toEqual({
      rowCount: 2,
    });
  });

  it('tolerates a BOM, header case and spacing, and blank lines', () => {
    const header = `\ufeff${TEMPLATE_HEADER.map((h) => ` ${h.toUpperCase()} `).join(',')}`;

    expect(checkUpload(file(csv(header, ROW, '', '')))).toEqual({ rowCount: 1 });
  });

  it.each([
    ['no file', undefined, 'Choose a CSV file to upload'],
    [
      'another file type',
      file(csv(HEADER, ROW), 'employees.xlsx'),
      'Upload a .csv file (in Excel: Save As → CSV UTF-8)',
    ],
    ['header only', file(csv(HEADER)), 'The file has no data rows'],
    [
      'a missing column',
      file(csv(HEADER.replace(',allowances', ''), ROW)),
      'Missing columns: allowances',
    ],
    ['an unknown column', file(csv(`${HEADER},bonus`, `${ROW},5000`)), 'Unknown columns: bonus'],
    ['broken CSV', file(csv(HEADER, 'EMP-1,"Asha,Verma')), /^The file is not valid CSV/],
  ])('rejects %s', (_case, upload, message) => {
    expect(() => checkUpload(upload)).toThrow(rejection('file', message));
  });

  it('rejects more than 20,000 data rows', () => {
    const rows = Array.from({ length: 20_001 }, () => ROW);

    expect(() => checkUpload(file(csv(HEADER, ...rows)))).toThrow(
      rejection('file', 'The file has 20,001 rows; the limit is 20,000'),
    );
  });

  it('rejects a file over 5 MB with 413', () => {
    expect(() => checkUpload(file(Buffer.alloc(5 * 1024 * 1024 + 1, 'a')))).toThrow(
      expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE', status: 413 }),
    );
  });
});

describe('importFormSchema', () => {
  const valid = {
    changeType: 'annual_review',
    effectiveDate: '2026-04-01',
    note: 'FY26 annual review',
  };

  it('accepts the change type, effective date and note for every row', () => {
    expect(importFormSchema.parse(valid)).toEqual(valid);
  });

  it.each([
    ['a missing change type', { changeType: undefined }, 'changeType'],
    ['relocation (decided per row)', { changeType: 'relocation' }, 'changeType'],
    ['a bad date', { effectiveDate: '2026-02-30' }, 'effectiveDate'],
    ['a short note', { note: 'ok' }, 'note'],
  ])('rejects %s', (_case, overrides, path) => {
    expect(
      importFormSchema
        .safeParse({ ...valid, ...overrides })
        .error?.issues.map((i) => i.path.join('.')),
    ).toEqual([path]);
  });
});
