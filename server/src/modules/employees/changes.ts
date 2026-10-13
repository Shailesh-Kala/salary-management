import { AppError } from '../../lib/errors.ts';
import { sameAmount } from '../../lib/money.ts';
import type { ChangeEventInput } from './employee.schemas.ts';
import type { EmployeeRow, Snapshot } from './employees.repository.ts';
import { employeeStatus } from './status.ts';

export type CurrentState = Pick<
  EmployeeRow,
  | 'baseSalary'
  | 'allowances'
  | 'jobTitle'
  | 'department'
  | 'countryCode'
  | 'hireDate'
  | 'exitType'
  | 'noticeDate'
  | 'lastWorkingDay'
> & { currencyCode: string };

/** Pay, place and role in effect, as recorded with every history entry. */
export const snapshotOf = (state: CurrentState): Snapshot => ({
  baseSalary: state.baseSalary,
  allowances: state.allowances,
  currencyCode: state.currencyCode,
  countryCode: state.countryCode,
  jobTitle: state.jobTitle,
  department: state.department,
});

export type ChangeContext = {
  today: string;
  /** Effective date of the employee's latest change; new changes may not go before it. */
  latestEffectiveDate: string | null;
  /** Earliest effective date of any change other than the hire itself. */
  firstNonHireDate: string | null;
  /** Currency of the relocation target country, or null when unknown or not a relocation. */
  newCountryCurrency: string | null;
};

export type AuditedField =
  'baseSalary' | 'allowances' | 'jobTitle' | 'department' | 'countryCode' | 'hireDate';

// Fixed order, so the recorded `changes` object reads the same way every time.
const AUDITED: AuditedField[] = [
  'baseSalary',
  'allowances',
  'jobTitle',
  'department',
  'countryCode',
  'hireDate',
];
const AMOUNTS = new Set<AuditedField>(['baseSalary', 'allowances']);

const invalid = (path: string, message: string) =>
  new AppError('VALIDATION_ERROR', 400, 'Invalid request', [{ path, message }]);

const earliest = (...dates: (string | null)[]) =>
  dates.filter((d): d is string => d !== null).sort()[0]!;

/**
 * Pure business rules for one change event (REQUIREMENTS §4.2, D-033, D-036): validates it
 * against the current state and returns what changed, the column updates and the new snapshot.
 */
export function planChange(current: CurrentState, input: ChangeEventInput, ctx: ChangeContext) {
  const isRelocation = input.changeType === 'relocation';
  const isCorrection = input.changeType === 'correction';

  if (employeeStatus(current.lastWorkingDay, ctx.today) === 'exited' && !isCorrection) {
    throw invalid('changeType', 'This employee has left: only corrections are allowed');
  }
  if (input.countryCode !== undefined && !isRelocation) {
    throw invalid('countryCode', 'Country can only change through a relocation');
  }
  if (input.hireDate !== undefined && !isCorrection) {
    throw invalid('hireDate', 'Hire date can only change through a correction');
  }
  if (isRelocation) {
    if (!input.countryCode) throw invalid('countryCode', 'Choose the new country');
    if (input.countryCode === current.countryCode) {
      throw invalid('countryCode', 'Choose a country other than the current one');
    }
    if (!ctx.newCountryCurrency) throw invalid('countryCode', 'Unsupported country');
    if (input.baseSalary === undefined) {
      throw invalid(
        'baseSalary',
        "Relocation needs the new base salary in the new country's currency",
      );
    }
    if (input.allowances === undefined) {
      throw invalid(
        'allowances',
        "Relocation needs the new allowances in the new country's currency",
      );
    }
  }
  if (input.hireDate !== undefined) {
    const latestAllowed = earliest(ctx.today, ctx.firstNonHireDate, current.noticeDate);
    if (input.hireDate > latestAllowed) {
      throw invalid('hireDate', `Hire date must be on or before ${latestAllowed}`);
    }
  }
  if (input.effectiveDate > ctx.today) {
    throw invalid('effectiveDate', 'Effective date cannot be in the future');
  }
  if (ctx.latestEffectiveDate && input.effectiveDate < ctx.latestEffectiveDate) {
    throw invalid(
      'effectiveDate',
      `Effective date must be on or after ${ctx.latestEffectiveDate} (the latest change)`,
    );
  }

  const changes: Partial<Record<AuditedField, { old: string; new: string }>> = {};
  const updates: Partial<Record<AuditedField, string>> = {};
  for (const field of AUDITED) {
    const next = input[field];
    if (next === undefined) continue;
    const old = current[field];
    const same = AMOUNTS.has(field) ? sameAmount(old, next) : old === next;
    if (!same) {
      changes[field] = { old, new: next };
      updates[field] = next;
    }
  }
  if (Object.keys(changes).length === 0) {
    throw invalid('', 'Nothing changed: enter at least one new value');
  }

  const after = { ...current, ...updates };
  const snapshot: Snapshot = {
    baseSalary: after.baseSalary,
    allowances: after.allowances,
    currencyCode: isRelocation ? ctx.newCountryCurrency! : current.currencyCode,
    countryCode: after.countryCode,
    jobTitle: after.jobTitle,
    department: after.department,
  };
  return { changes, updates, snapshot };
}
