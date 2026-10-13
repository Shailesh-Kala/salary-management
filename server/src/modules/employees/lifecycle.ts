import { invalidField } from '../../lib/errors.ts';
import { type CurrentState, snapshotOf } from './changes.ts';
import type { ExitInput } from './employee.schemas.ts';
import { employeeStatus } from './status.ts';

export type LifecycleContext = { today: string; latestEffectiveDate: string | null };

export type ExitFields = Pick<CurrentState, 'exitType' | 'noticeDate' | 'lastWorkingDay'>;

const diff = (before: ExitFields, after: ExitFields) => ({
  exitType: { old: before.exitType, new: after.exitType },
  noticeDate: { old: before.noticeDate, new: after.noticeDate },
  lastWorkingDay: { old: before.lastWorkingDay, new: after.lastWorkingDay },
});

/** Records a resignation or termination (REQUIREMENTS §4.3); effective on the notice date. */
export function planExit(current: CurrentState, input: ExitInput, ctx: LifecycleContext) {
  const status = employeeStatus(current.lastWorkingDay, ctx.today);
  if (status === 'on_notice') {
    throw invalidField('', 'An exit is already recorded: withdraw it first to change it');
  }
  if (status === 'exited') throw invalidField('', 'This employee has already left');
  if (input.noticeDate < current.hireDate) {
    throw invalidField(
      'noticeDate',
      `Notice date must be on or after the hire date (${current.hireDate})`,
    );
  }
  if (input.noticeDate > ctx.today) {
    throw invalidField('noticeDate', 'Notice date cannot be in the future');
  }
  if (ctx.latestEffectiveDate && input.noticeDate < ctx.latestEffectiveDate) {
    throw invalidField(
      'noticeDate',
      `Notice date must be on or after ${ctx.latestEffectiveDate} (the latest change)`,
    );
  }
  if (input.lastWorkingDay < input.noticeDate) {
    throw invalidField('lastWorkingDay', 'Last working day must be on or after the notice date');
  }

  const exit = {
    exitType: input.exitType,
    noticeDate: input.noticeDate,
    lastWorkingDay: input.lastWorkingDay,
  };
  return {
    exit,
    changes: diff(current, exit),
    snapshot: snapshotOf(current),
    effectiveDate: input.noticeDate,
  };
}

/** Cancels an exit while the employee is still serving notice; effective today. */
export function planWithdraw(current: CurrentState, ctx: LifecycleContext) {
  const status = employeeStatus(current.lastWorkingDay, ctx.today);
  if (status === 'active') throw invalidField('', 'There is no exit to withdraw');
  if (status === 'exited') {
    throw invalidField(
      '',
      'This employee has already left, so the exit can no longer be withdrawn',
    );
  }

  const exit = { exitType: null, noticeDate: null, lastWorkingDay: null };
  return {
    exit,
    changes: diff(current, exit),
    snapshot: snapshotOf(current),
    effectiveDate: ctx.today,
  };
}
