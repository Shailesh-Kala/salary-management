import { describe, expect, it } from 'vitest';
import { TEMPLATE_HEADER, type ImportForm } from './upload.ts';
import { type ExistingEmployee, type RowContext, validateRows } from './validate-rows.ts';

const TODAY = '2026-10-12';
const form: ImportForm = {
  changeType: 'annual_review',
  effectiveDate: '2026-10-01',
  note: 'FY26 annual review',
};

const asha: ExistingEmployee = {
  id: 'e1',
  employeeCode: 'EMP-1',
  firstName: 'Asha',
  lastName: 'Verma',
  email: 'asha@acme.com',
  jobTitle: 'Software Engineer',
  department: 'Engineering',
  countryCode: 'IN',
  currencyCode: 'INR',
  hireDate: '2024-04-01',
  baseSalary: '1800000.00',
  allowances: '200000.00',
  exitType: null,
  noticeDate: null,
  lastWorkingDay: null,
  version: 3,
  latestEffectiveDate: '2025-04-01',
  firstNonHireDate: '2025-04-01',
};

const context = (
  employees: ExistingEmployee[] = [asha],
  overrides: Partial<RowContext> = {},
): RowContext => ({
  form,
  today: TODAY,
  employeesByCode: new Map(employees.map((e) => [e.employeeCode, e])),
  employeeCodeByEmail: new Map(employees.map((e) => [e.email, e.employeeCode])),
  currencyByCountry: new Map([
    ['IN', 'INR'],
    ['US', 'USD'],
    ['FR', 'EUR'],
  ]),
  ...overrides,
});

// Row values in template order: code, first, last, email, title, department, country, hire, base, allowances
const ashaRow = [
  'EMP-1',
  'Asha',
  'Verma',
  'asha@acme.com',
  'Software Engineer',
  'Engineering',
  'IN',
  '2024-04-01',
  '1800000',
  '200000',
];
const newRow = [
  'EMP-9',
  'Nina',
  'Shah',
  'nina@acme.com',
  'Analyst',
  'Finance',
  'US',
  '2026-09-01',
  '90000',
  '5000',
];
const withValue = (row: string[], column: (typeof TEMPLATE_HEADER)[number], value: string) =>
  row.map((v, i) => (TEMPLATE_HEADER[i] === column ? value : v));

const validate = (rows: string[][], ctx = context(), header: string[] = [...TEMPLATE_HEADER]) =>
  validateRows(header, rows, ctx);
const only = (rows: string[][], ctx = context()) => validate(rows, ctx)[0]!;

describe('validateRows: outcomes', () => {
  it('creates a new employee with a hire change on the row’s own hire date (T18)', () => {
    const result = only([newRow]);

    expect(result).toMatchObject({
      rowNumber: 1,
      employeeCode: 'EMP-9',
      outcome: 'create',
      errors: [],
    });
    expect(result.change).toMatchObject({
      changeType: 'hire',
      effectiveDate: '2026-09-01',
      note: form.note,
    });
    expect(result.change?.snapshot).toMatchObject({ currencyCode: 'USD', baseSalary: '90000' });
  });

  it('marks an identical row unchanged, comparing amounts by value', () => {
    expect(only([ashaRow])).toMatchObject({ outcome: 'unchanged', errors: [], change: null });
  });

  it('updates name or email without a history entry (T18)', () => {
    const result = only([
      withValue(withValue(ashaRow, 'last_name', 'Sharma'), 'email', 'asha.sharma@acme.com'),
    ]);

    expect(result).toMatchObject({ outcome: 'update', change: null });
    expect(result.profile).toEqual({ lastName: 'Sharma', email: 'asha.sharma@acme.com' });
  });

  it('records pay and title changes as one change with the import’s type and effective date', () => {
    const result = only([
      withValue(
        withValue(ashaRow, 'base_salary', '2000000'),
        'job_title',
        'Senior Software Engineer',
      ),
    ]);

    expect(result.outcome).toBe('update');
    expect(result.change).toMatchObject({
      changeType: 'annual_review',
      effectiveDate: '2026-10-01',
      changes: {
        baseSalary: { old: '1800000.00', new: '2000000' },
        jobTitle: { old: 'Software Engineer', new: 'Senior Software Engineer' },
      },
    });
  });

  it('relocates when the country and the salary both change', () => {
    const result = only([withValue(withValue(ashaRow, 'country', 'US'), 'base_salary', '150000')]);

    expect(result.change).toMatchObject({
      changeType: 'relocation',
      snapshot: { countryCode: 'US', currencyCode: 'USD' },
    });
  });
});

describe('validateRows: rejections', () => {
  const rejected = (rows: string[][], ctx = context()) => {
    const result = validate(rows, ctx).at(-1)!;
    expect(result.outcome).toBe('rejected');
    return result.errors;
  };

  it('names each invalid field by its column', () => {
    expect(rejected([withValue(withValue(newRow, 'email', 'nope'), 'base_salary', '-5')])).toEqual([
      'email: Enter a valid email address, like name@company.com',
      'base_salary: Enter a plain number like 95000 or 95000.50, with no commas or currency symbols',
    ]);
  });

  it('rejects a row with the wrong number of values', () => {
    expect(rejected([newRow.slice(0, 9)])).toEqual(['Expected 10 values, found 9']);
  });

  it('rejects example rows left in from the template', () => {
    expect(rejected([withValue(newRow, 'employee_code', 'EXAMPLE-2')])).toEqual([
      'Example row: replace it with a real employee or delete it',
    ]);
  });

  it.each([
    [
      'employee code',
      withValue(newRow, 'email', 'other@acme.com'),
      'employee_code: also on row 1 of this file',
    ],
    ['email', withValue(newRow, 'employee_code', 'EMP-10'), 'email: also on row 1 of this file'],
  ])('rejects a later row with a duplicate %s, keeping the first', (_case, second, message) => {
    const results = validate([newRow, second]);

    expect(results[0]!.outcome).toBe('create');
    expect(results[1]!.errors).toEqual([message]);
  });

  it('rejects an email that belongs to another employee', () => {
    expect(rejected([withValue(newRow, 'email', 'ASHA@acme.com')])).toEqual([
      'email: already used by EMP-1',
    ]);
  });

  it('rejects an unsupported country and a future hire date for a new employee', () => {
    expect(rejected([withValue(newRow, 'country', 'JP')])).toEqual([
      'country: Unsupported country',
    ]);
    expect(rejected([withValue(newRow, 'hire_date', '2026-10-13')])).toEqual([
      'hire_date: Hire date cannot be in the future',
    ]);
  });

  it('rejects a change dated before the employee’s latest change', () => {
    const recent = { ...asha, latestEffectiveDate: '2026-10-05' };

    expect(rejected([withValue(ashaRow, 'base_salary', '2000000')], context([recent]))).toEqual([
      'effective_date: Effective date must be on or after 2026-10-05 (the latest change)',
    ]);
  });

  it('rejects a country change without a new salary', () => {
    expect(rejected([withValue(ashaRow, 'country', 'US')])).toEqual([
      "country: relocation requires the new salary in the new country's currency",
    ]);
  });
});

describe('validateRows: correction-only changes (T18)', () => {
  const correction = (ctx: RowContext) => ({
    ...ctx,
    form: { ...form, changeType: 'correction' as const },
  });

  it('changes a hire date only in a correction import', () => {
    const row = withValue(ashaRow, 'hire_date', '2024-03-01');

    expect(only([row]).errors).toEqual([
      'hire_date: hire date can only change in a correction import',
    ]);
    expect(only([row], correction(context())).change).toMatchObject({
      changeType: 'correction',
      changes: { hireDate: { old: '2024-04-01', new: '2024-03-01' } },
    });
  });

  it('changes pay for someone who has left only in a correction import, but still fixes their name', () => {
    const left = {
      ...asha,
      exitType: 'resigned' as const,
      noticeDate: '2026-08-01',
      lastWorkingDay: '2026-09-30',
    };
    const ctx = context([left]);

    expect(only([withValue(ashaRow, 'base_salary', '2000000')], ctx).errors).toEqual([
      'This employee has left: only a correction import can change pay, title, department, country or hire date',
    ]);
    expect(only([withValue(ashaRow, 'base_salary', '2000000')], correction(ctx)).outcome).toBe(
      'update',
    );
    expect(only([withValue(ashaRow, 'first_name', 'Aasha')], ctx)).toMatchObject({
      outcome: 'update',
      change: null,
    });
  });
});

describe('validateRows: columns', () => {
  it('reads columns by header name, whatever their order or case', () => {
    const header = [...TEMPLATE_HEADER].reverse().map((h) => h.toUpperCase());

    expect(validate([[...newRow].reverse()], context(), header)[0]!.outcome).toBe('create');
  });

  it('keeps the original values for the rejected-rows file', () => {
    expect(only([withValue(newRow, 'base_salary', 'abc')]).raw).toEqual(
      Object.fromEntries(
        TEMPLATE_HEADER.map((h, i) => [h, withValue(newRow, 'base_salary', 'abc')[i]]),
      ),
    );
  });
});
