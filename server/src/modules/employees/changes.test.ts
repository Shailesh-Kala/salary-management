import { describe, expect, it } from 'vitest';
import { AppError } from '../../lib/errors.ts';
import { changeEventSchema, type ChangeEventInput } from './employee.schemas.ts';
import { type ChangeContext, type CurrentState, planChange } from './changes.ts';

const employee: CurrentState = {
  baseSalary: '1800000.00',
  allowances: '200000.00',
  jobTitle: 'Software Engineer',
  department: 'Engineering',
  countryCode: 'IN',
  currencyCode: 'INR',
  hireDate: '2024-04-01',
  noticeDate: null,
  lastWorkingDay: null,
};

const context: ChangeContext = {
  today: '2026-10-12',
  latestEffectiveDate: '2025-04-01',
  firstNonHireDate: '2025-04-01',
  newCountryCurrency: null,
};

const input = (overrides: Partial<ChangeEventInput> = {}): ChangeEventInput => ({
  version: 1,
  changeType: 'annual_review',
  effectiveDate: '2026-04-01',
  note: 'FY26 review: strong year',
  ...overrides,
});

const rejection = (path: string, message: string | RegExp) =>
  expect.objectContaining({
    code: 'VALIDATION_ERROR',
    details: [
      { path, message: typeof message === 'string' ? message : expect.stringMatching(message) },
    ],
  });

const plan = (overrides: Partial<ChangeEventInput>, state = employee, ctx = context) =>
  planChange(state, input(overrides), ctx);

describe('planChange: what changed', () => {
  it('records only the fields that actually change', () => {
    const result = plan({ baseSalary: '2000000', jobTitle: 'Software Engineer' });

    expect(result.changes).toEqual({ baseSalary: { old: '1800000.00', new: '2000000' } });
    expect(result.updates).toEqual({ baseSalary: '2000000' });
  });

  it('treats the same amount written differently as unchanged', () => {
    const result = plan({ baseSalary: '1800000', allowances: '210000.5' });

    expect(result.changes).toEqual({ allowances: { old: '200000.00', new: '210000.5' } });
  });

  it('rejects a change event that changes nothing', () => {
    expect(() => plan({ baseSalary: '1800000.00', department: 'Engineering' })).toThrow(
      new AppError('VALIDATION_ERROR', 400, 'Invalid request', [
        { path: '', message: 'Nothing changed: enter at least one new value' },
      ]),
    );
  });

  it('records a promotion with a new title and salary as one event and snapshot', () => {
    const result = plan({
      changeType: 'promotion',
      jobTitle: 'Senior Software Engineer',
      baseSalary: '2400000',
    });

    expect(Object.keys(result.changes)).toEqual(['baseSalary', 'jobTitle']);
    expect(result.snapshot).toEqual({
      baseSalary: '2400000',
      allowances: '200000.00',
      currencyCode: 'INR',
      countryCode: 'IN',
      jobTitle: 'Senior Software Engineer',
      department: 'Engineering',
    });
  });
});

describe('planChange: effective date', () => {
  it('rejects a future effective date (in the org time zone)', () => {
    expect(() => plan({ effectiveDate: '2026-10-13', baseSalary: '2000000' })).toThrow(
      rejection('effectiveDate', 'Effective date cannot be in the future'),
    );
  });

  it('rejects a date before the latest recorded change, keeping history in order', () => {
    expect(() => plan({ effectiveDate: '2025-03-31', baseSalary: '2000000' })).toThrow(
      rejection(
        'effectiveDate',
        'Effective date must be on or after 2025-04-01 (the latest change)',
      ),
    );
  });

  it('accepts a back-dated change on the latest change date or later', () => {
    expect(plan({ effectiveDate: '2025-04-01', baseSalary: '2000000' }).changes).toHaveProperty(
      'baseSalary',
    );
  });
});

describe('planChange: relocation (D-033)', () => {
  const relocate = (overrides: Partial<ChangeEventInput> = {}, currency: string | null = 'USD') =>
    plan(
      {
        changeType: 'relocation',
        countryCode: 'US',
        baseSalary: '150000',
        allowances: '10000',
        ...overrides,
      },
      employee,
      { ...context, newCountryCurrency: currency },
    );

  it('changes country only through a relocation', () => {
    expect(() => plan({ countryCode: 'US', baseSalary: '150000' })).toThrow(
      rejection('countryCode', 'Country can only change through a relocation'),
    );
  });

  it.each([
    ['baseSalary', { baseSalary: undefined }],
    ['allowances', { allowances: undefined }],
  ])('requires the new %s in the new currency', (field, overrides) => {
    expect(() => relocate(overrides)).toThrow(rejection(field, /in the new country's currency/));
  });

  it('requires a different, supported country', () => {
    expect(() => relocate({ countryCode: 'IN' }, 'INR')).toThrow(
      rejection('countryCode', 'Choose a country other than the current one'),
    );
    expect(() => relocate({}, null)).toThrow(rejection('countryCode', 'Unsupported country'));
  });

  it('snapshots the new country and currency with the new pay', () => {
    const result = relocate();

    expect(result.changes).toEqual({
      baseSalary: { old: '1800000.00', new: '150000' },
      allowances: { old: '200000.00', new: '10000' },
      countryCode: { old: 'IN', new: 'US' },
    });
    expect(result.snapshot).toMatchObject({
      countryCode: 'US',
      currencyCode: 'USD',
      baseSalary: '150000',
    });
  });
});

describe('planChange: hire date correction', () => {
  it('changes the hire date only through a correction', () => {
    expect(() => plan({ hireDate: '2024-03-01' })).toThrow(
      rejection('hireDate', 'Hire date can only change through a correction'),
    );
  });

  it('accepts an earlier hire date as a correction', () => {
    const result = plan({ changeType: 'correction', hireDate: '2024-03-01' });

    expect(result.changes).toEqual({ hireDate: { old: '2024-04-01', new: '2024-03-01' } });
  });

  it.each([
    ['after the first recorded change', '2025-04-02', /on or before 2025-04-01/],
    ['in the future', '2026-10-13', /on or before 2025-04-01/],
  ])('rejects a hire date %s', (_case, hireDate, message) => {
    expect(() => plan({ changeType: 'correction', hireDate })).toThrow(
      rejection('hireDate', message),
    );
  });

  it('rejects a hire date after the notice date', () => {
    const leaving = { ...employee, noticeDate: '2024-06-01', lastWorkingDay: '2024-07-31' };

    expect(() =>
      plan({ changeType: 'correction', hireDate: '2024-06-02' }, leaving, {
        ...context,
        firstNonHireDate: null,
      }),
    ).toThrow(rejection('hireDate', 'Hire date must be on or before 2024-06-01'));
  });
});

describe('planChange: exited employees', () => {
  const exited = { ...employee, noticeDate: '2026-08-01', lastWorkingDay: '2026-09-30' };

  it('accepts only corrections once the employee has left', () => {
    expect(() => plan({ baseSalary: '2000000' }, exited)).toThrow(
      rejection('changeType', 'This employee has left: only corrections are allowed'),
    );
    expect(
      plan({ changeType: 'correction', baseSalary: '2000000' }, exited).changes,
    ).toHaveProperty('baseSalary');
  });
});

describe('changeEventSchema', () => {
  const valid = {
    version: 1,
    changeType: 'promotion',
    effectiveDate: '2026-10-01',
    note: 'Promoted after review',
  };

  it.each([
    ['a reserved change type', { changeType: 'hire' }, 'changeType'],
    ['a missing note', { note: undefined }, 'note'],
    ['a too-short note', { note: ' ok ' }, 'note'],
    ['a too-long note', { note: 'x'.repeat(1001) }, 'note'],
    ['an unknown field', { email: 'x@acme.com' }, ''],
  ])('rejects %s', (_case, overrides, path) => {
    const result = changeEventSchema.safeParse({ ...valid, ...overrides });

    expect(result.error?.issues.map((i) => i.path.join('.'))).toEqual([path]);
  });
});
