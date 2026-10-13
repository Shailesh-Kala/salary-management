import { describe, expect, it } from 'vitest';
import type { CurrentState } from './changes.ts';
import { exitSchema, withdrawExitSchema } from './employee.schemas.ts';
import { planExit, planWithdraw } from './lifecycle.ts';

const TODAY = '2026-10-12';
const active: CurrentState = {
  baseSalary: '1800000.00',
  allowances: '200000.00',
  jobTitle: 'Software Engineer',
  department: 'Engineering',
  countryCode: 'IN',
  currencyCode: 'INR',
  hireDate: '2024-04-01',
  exitType: null,
  noticeDate: null,
  lastWorkingDay: null,
};
const onNotice: CurrentState = {
  ...active,
  exitType: 'resigned',
  noticeDate: '2026-10-01',
  lastWorkingDay: '2026-11-30',
};
const exited: CurrentState = {
  ...active,
  exitType: 'resigned',
  noticeDate: '2026-08-01',
  lastWorkingDay: '2026-09-30',
};
const context = { today: TODAY, latestEffectiveDate: '2025-04-01' };

const resignation = {
  version: 1,
  exitType: 'resigned' as const,
  noticeDate: '2026-10-01',
  lastWorkingDay: '2026-11-30',
  note: 'Moving abroad; resignation accepted',
};

const rejection = (path: string, message: string) =>
  expect.objectContaining({ code: 'VALIDATION_ERROR', details: [{ path, message }] });

describe('planExit', () => {
  it('records the exit fields and keeps the pay snapshot', () => {
    const plan = planExit(active, resignation, context);

    expect(plan.changes).toEqual({
      exitType: { old: null, new: 'resigned' },
      noticeDate: { old: null, new: '2026-10-01' },
      lastWorkingDay: { old: null, new: '2026-11-30' },
    });
    expect(plan.exit).toEqual({
      exitType: 'resigned',
      noticeDate: '2026-10-01',
      lastWorkingDay: '2026-11-30',
    });
    expect(plan.snapshot).toMatchObject({ baseSalary: '1800000.00', currencyCode: 'INR' });
  });

  it('allows an immediate termination and a back-dated exit that has already ended', () => {
    expect(() =>
      planExit(
        active,
        { ...resignation, exitType: 'terminated', noticeDate: TODAY, lastWorkingDay: TODAY },
        context,
      ),
    ).not.toThrow();
    expect(() =>
      planExit(
        active,
        { ...resignation, noticeDate: '2026-08-01', lastWorkingDay: '2026-09-30' },
        context,
      ),
    ).not.toThrow();
  });

  it.each([
    [
      'notice before the hire date',
      { noticeDate: '2024-03-31' },
      'noticeDate',
      'Notice date must be on or after the hire date (2024-04-01)',
    ],
    [
      'notice in the future',
      { noticeDate: '2026-10-13', lastWorkingDay: '2026-12-31' },
      'noticeDate',
      'Notice date cannot be in the future',
    ],
    [
      'notice before the latest change',
      { noticeDate: '2025-03-31' },
      'noticeDate',
      'Notice date must be on or after 2025-04-01 (the latest change)',
    ],
    [
      'last working day before the notice date',
      { lastWorkingDay: '2026-09-30' },
      'lastWorkingDay',
      'Last working day must be on or after the notice date',
    ],
  ])('rejects %s', (_case, overrides, path, message) => {
    expect(() => planExit(active, { ...resignation, ...overrides }, context)).toThrow(
      rejection(path, message),
    );
  });

  it.each([
    ['already on notice', onNotice, 'An exit is already recorded: withdraw it first to change it'],
    ['already exited', exited, 'This employee has already left'],
  ])('rejects a new exit when %s', (_case, state, message) => {
    expect(() => planExit(state, resignation, context)).toThrow(rejection('', message));
  });
});

describe('planWithdraw', () => {
  it('clears the exit fields while the employee is on notice', () => {
    const plan = planWithdraw(onNotice, context);

    expect(plan.changes).toEqual({
      exitType: { old: 'resigned', new: null },
      noticeDate: { old: '2026-10-01', new: null },
      lastWorkingDay: { old: '2026-11-30', new: null },
    });
    expect(plan.effectiveDate).toBe(TODAY);
  });

  it.each([
    ['no exit is recorded', active, 'There is no exit to withdraw'],
    [
      'the employee has already left',
      exited,
      'This employee has already left, so the exit can no longer be withdrawn',
    ],
  ])('rejects a withdrawal when %s', (_case, state, message) => {
    expect(() => planWithdraw(state, context)).toThrow(rejection('', message));
  });
});

describe('exit schemas', () => {
  it.each([
    ['an unknown exit type', { exitType: 'retired' }, 'exitType'],
    ['a missing note', { note: undefined }, 'note'],
    ['a missing last working day', { lastWorkingDay: undefined }, 'lastWorkingDay'],
  ])('reject %s', (_case, overrides, path) => {
    const result = exitSchema.safeParse({ ...resignation, ...overrides });

    expect(result.error?.issues.map((i) => i.path.join('.'))).toEqual([path]);
  });

  it('requires a note to withdraw', () => {
    expect(
      withdrawExitSchema.safeParse({ version: 2 }).error?.issues.map((i) => i.path[0]),
    ).toEqual(['note']);
  });
});
