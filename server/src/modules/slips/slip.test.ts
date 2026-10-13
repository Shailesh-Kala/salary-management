import { describe, expect, it } from 'vitest';
import { buildSlip, type SlipEmployee, type SlipSnapshot } from './slip.ts';

const TODAY = '2026-10-12';
const employee: SlipEmployee = {
  id: 'e1',
  employeeCode: 'EMP-00001',
  firstName: 'Asha',
  lastName: 'Verma',
  hireDate: '2024-04-15',
  exitType: null,
  noticeDate: null,
  lastWorkingDay: null,
};
const snapshot: SlipSnapshot = {
  baseSalary: '1800000.00',
  allowances: '200000.06',
  currencyCode: 'INR',
  countryCode: 'IN',
  countryName: 'India',
  jobTitle: 'Software Engineer',
  department: 'Engineering',
};

const slip = (month: string, e = employee, s = snapshot) =>
  buildSlip({ employee: e, snapshot: s, month, today: TODAY });

const rejection = (message: string) =>
  expect.objectContaining({ code: 'VALIDATION_ERROR', details: [{ path: 'month', message }] });

describe('buildSlip', () => {
  it('splits annual pay into monthly earnings and gross, half-up to the cent', () => {
    expect(slip('2026-09')).toEqual({
      employee: { id: 'e1', employeeCode: 'EMP-00001', firstName: 'Asha', lastName: 'Verma' },
      month: '2026-09',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      jobTitle: 'Software Engineer',
      department: 'Engineering',
      countryCode: 'IN',
      countryName: 'India',
      currencyCode: 'INR',
      status: 'active',
      lastWorkingDay: null,
      earnings: [
        { label: 'Base salary', amount: '150000.00' },
        { label: 'Allowances', amount: '16666.67' }, // 200,000.06 ÷ 12 = 16,666.6716…
      ],
      grossPay: '166666.67',
      notice: 'Gross pay only. Statutory deductions are not calculated.',
    });
  });

  it('adds the rounded lines, so gross always equals the sum shown', () => {
    const result = slip('2026-09', employee, {
      ...snapshot,
      baseSalary: '100000.06',
      allowances: '100000.06',
    });

    expect(result.earnings.map((e) => e.amount)).toEqual(['8333.34', '8333.34']); // 8,333.3383…
    expect(result.grossPay).toBe('16666.68');
  });

  it('knows the length of each month, including leap years', () => {
    expect(slip('2026-02').periodEnd).toBe('2026-02-28');
    expect(slip('2025-02').periodEnd).toBe('2025-02-28');
    expect(slip('2024-12').periodEnd).toBe('2024-12-31');
    expect(slip('2026-04').periodEnd).toBe('2026-04-30');
  });

  it('allows the hire month but not a month before it', () => {
    expect(slip('2024-04').periodStart).toBe('2024-04-01');
    expect(() => slip('2024-03')).toThrow(rejection('Asha Verma joined on 2024-04-15'));
  });

  it('allows the month of the last working day but not after it', () => {
    const leaver = {
      ...employee,
      exitType: 'resigned' as const,
      noticeDate: '2026-07-01',
      lastWorkingDay: '2026-08-10',
    };

    expect(slip('2026-08', leaver)).toMatchObject({
      status: 'exited',
      lastWorkingDay: '2026-08-10',
    });
    expect(() => slip('2026-09', leaver)).toThrow(
      rejection("Asha Verma's last working day was 2026-08-10"),
    );
  });

  it('allows the current month but not a future one (in the org time zone)', () => {
    expect(slip('2026-10').month).toBe('2026-10');
    expect(() => slip('2026-11')).toThrow(
      rejection('Slips can only be generated for the current or past months'),
    );
  });
});
