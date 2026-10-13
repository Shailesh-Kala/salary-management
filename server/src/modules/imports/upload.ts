import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { AppError, invalidField } from '../../lib/errors.ts';
import { isoDate, note } from '../employees/employee.schemas.ts';

/** Columns of the import template, in order (the export starts with the same ones). */
export const TEMPLATE_HEADER = [
  'employee_code',
  'first_name',
  'last_name',
  'email',
  'job_title',
  'department',
  'country',
  'hire_date',
  'base_salary',
  'allowances',
] as const;

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 20_000;

/** Applied to every change the import makes; relocation is decided per row, not chosen here. */
export const importFormSchema = z.strictObject({
  changeType: z.enum(['annual_review', 'promotion', 'market_adjustment', 'correction', 'other']),
  effectiveDate: isoDate,
  note,
});

export type ImportForm = z.infer<typeof importFormSchema>;

export const importHistoryQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** Parses CSV text (BOM and blank lines allowed); rows may have any length, checked per row later. */
export const parseCsv = (content: Buffer | string) =>
  parse(content, { bom: true, skip_empty_lines: true, relax_column_count: true }) as string[][];

/** The checks done before an upload is accepted (REQUIREMENTS §4.8 step 2). */
export function checkUpload(file: { originalname: string; buffer: Buffer } | undefined) {
  if (!file) throw invalidField('file', 'Choose a CSV file to upload');
  if (file.buffer.length > MAX_FILE_BYTES) {
    throw new AppError('PAYLOAD_TOO_LARGE', 413, 'The file is larger than 5 MB', [
      { path: 'file', message: 'The file is larger than 5 MB' },
    ]);
  }
  if (!/\.csv$/i.test(file.originalname)) {
    throw invalidField('file', 'Upload a .csv file (in Excel: Save As → CSV UTF-8)');
  }

  let records: string[][];
  try {
    records = parseCsv(file.buffer);
  } catch (err) {
    throw invalidField('file', `The file is not valid CSV: ${(err as Error).message}`);
  }
  const [header = [], ...rows] = records;
  const columns = header.map((column) => column.trim().toLowerCase());
  const missing = TEMPLATE_HEADER.filter((column) => !columns.includes(column));
  // The rejected-rows file adds an `error` column; it is ignored so that file can be re-uploaded.
  const known: readonly string[] = [...TEMPLATE_HEADER, 'error'];
  const unknown = columns.filter((column) => !known.includes(column));
  if (missing.length) throw invalidField('file', `Missing columns: ${missing.join(', ')}`);
  if (unknown.length) throw invalidField('file', `Unknown columns: ${unknown.join(', ')}`);
  if (rows.length === 0) throw invalidField('file', 'The file has no data rows');
  if (rows.length > MAX_ROWS) {
    throw invalidField(
      'file',
      `The file has ${rows.length.toLocaleString('en-US')} rows; the limit is ${MAX_ROWS.toLocaleString('en-US')}`,
    );
  }
  return { rowCount: rows.length };
}

const EXAMPLE_ROWS = [
  [
    'EXAMPLE-1',
    'Asha',
    'Verma',
    'asha.verma@example.com',
    'Software Engineer',
    'Engineering',
    'IN',
    '2024-04-01',
    '1800000',
    '200000',
  ],
  [
    'EXAMPLE-2',
    'Ben',
    'Carter',
    'ben.carter@example.com',
    'Account Executive',
    'Sales',
    'US',
    '2023-01-15',
    '150000.50',
    '10000',
  ],
  [
    'EXAMPLE-3',
    'Chloe',
    'Martin',
    'chloe.martin@example.com',
    'Financial Analyst',
    'Finance',
    'FR',
    '2025-06-30',
    '60000',
    '0',
  ],
];

/** The downloadable template: header plus example rows showing formats (rejected if left in). */
export const templateCsv = () =>
  `\ufeff${[TEMPLATE_HEADER, ...EXAMPLE_ROWS].map((row) => row.join(',')).join('\n')}\n`;
