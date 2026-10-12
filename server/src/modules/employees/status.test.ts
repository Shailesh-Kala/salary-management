import { describe, expect, it } from 'vitest';
import { employeeStatus } from './status.ts';

const TODAY = '2026-10-12';

describe('employeeStatus', () => {
  it.each([
    ['no exit recorded', null, 'active'],
    ['last working day still ahead', '2026-11-30', 'on_notice'],
    ['today is the last working day', '2026-10-12', 'on_notice'],
    ['last working day was yesterday', '2026-10-11', 'exited'],
  ] as const)('%s → %s', (_case, lastWorkingDay, expected) => {
    expect(employeeStatus(lastWorkingDay, TODAY)).toBe(expected);
  });
});
