import { AppError } from '../../lib/errors.ts';
import { sameAmount } from '../../lib/money.ts';
import { type CurrentState, planChange } from '../employees/changes.ts';
import { type CreateEmployeeInput, createEmployeeSchema } from '../../shared/employee-rules.ts';
import type { Snapshot } from '../employees/employees.repository.ts';
import { employeeStatus } from '../employees/status.ts';
import { type ImportForm, TEMPLATE_HEADER } from './upload.ts';

export type Column = (typeof TEMPLATE_HEADER)[number];

export type ExistingEmployee = CurrentState & {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string;
  version: number;
  latestEffectiveDate: string | null;
  firstNonHireDate: string | null;
};

export type RowContext = {
  form: ImportForm;
  today: string;
  employeesByCode: Map<string, ExistingEmployee>;
  employeeCodeByEmail: Map<string, string>;
  currencyByCountry: Map<string, string>;
};

export type PlannedChange = {
  changeType: string;
  effectiveDate: string;
  note: string;
  changes: Record<string, { old: unknown; new: unknown }>;
  snapshot: Snapshot;
};

export type RowResult = {
  rowNumber: number;
  employeeCode: string | null;
  /** The row's original values, for the rejected-rows file. */
  raw: Record<Column, string>;
  outcome: 'create' | 'update' | 'unchanged' | 'rejected';
  errors: string[];
  /** For a new employee: every field. */
  employee?: CreateEmployeeInput;
  /** For an existing employee: changed name/email (not audited) and audited column updates. */
  profile?: Partial<Pick<CreateEmployeeInput, 'firstName' | 'lastName' | 'email'>>;
  updates?: Partial<Record<string, string>>;
  change: PlannedChange | null;
};

const FIELD_COLUMNS: Record<string, string> = {
  employeeCode: 'employee_code',
  firstName: 'first_name',
  lastName: 'last_name',
  email: 'email',
  jobTitle: 'job_title',
  department: 'department',
  countryCode: 'country',
  hireDate: 'hire_date',
  baseSalary: 'base_salary',
  allowances: 'allowances',
  effectiveDate: 'effective_date',
};

/** "column: message", or just the message for a whole-row problem. */
const describe = (path: string, message: string) =>
  path ? `${FIELD_COLUMNS[path] ?? path}: ${message}` : message;

class RowRejected extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors.join('; '));
    this.errors = errors;
  }
}
const reject = (...errors: string[]): never => {
  throw new RowRejected(errors);
};

const PROFILE_FIELDS = ['firstName', 'lastName', 'email'] as const;

/**
 * Decides what to do with a row that failed in a way the rules did not expect (a bug, not bad
 * data): it returns the reason to show for that row, after reporting the error; or it rethrows
 * to fail the caller. There is deliberately no default, so no caller hides such errors.
 */
export type OnUnexpected = (err: unknown, rowNumber: number) => string;

/**
 * The import row rules (REQUIREMENTS §4.8, D-036), shared by the preview and the apply step:
 * pure, so the same file and data always give the same outcome. Pay and title changes go through
 * `planChange`, so an import can never do what the change dialog forbids. Bad data rejects that
 * row; an unexpected error goes to `onUnexpected`.
 */
export function validateRows(
  header: string[],
  rows: string[][],
  ctx: RowContext,
  onUnexpected: OnUnexpected,
): RowResult[] {
  const columns = header.map((h) => h.trim().toLowerCase());
  const positions = TEMPLATE_HEADER.map((column) => columns.indexOf(column));
  const firstRowWithCode = new Map<string, number>();
  const firstRowWithEmail = new Map<string, number>();

  return rows.map((values, i) => {
    const rowNumber = i + 1;
    const raw = Object.fromEntries(
      TEMPLATE_HEADER.map((column, k) => [column, values[positions[k]!] ?? '']),
    ) as Record<Column, string>;
    const employeeCode = raw.employee_code.trim().toUpperCase() || null;
    try {
      if (values.length !== header.length) {
        reject(`Expected ${header.length} values, found ${values.length}`);
      }
      const seen = { firstRowWithCode, firstRowWithEmail };
      return { rowNumber, employeeCode, raw, ...classify(raw, rowNumber, ctx, seen) };
    } catch (err) {
      const errors = err instanceof RowRejected ? err.errors : [onUnexpected(err, rowNumber)];
      return { rowNumber, employeeCode, raw, outcome: 'rejected', errors, change: null };
    }
  });
}

function classify(
  raw: Record<Column, string>,
  rowNumber: number,
  ctx: RowContext,
  seen: { firstRowWithCode: Map<string, number>; firstRowWithEmail: Map<string, number> },
): Omit<RowResult, 'rowNumber' | 'employeeCode' | 'raw'> {
  if (/^EXAMPLE-/i.test(raw.employee_code.trim())) {
    reject('Example row: replace it with a real employee or delete it');
  }
  const parsed = createEmployeeSchema.safeParse({
    employeeCode: raw.employee_code,
    firstName: raw.first_name,
    lastName: raw.last_name,
    email: raw.email,
    jobTitle: raw.job_title,
    department: raw.department,
    countryCode: raw.country,
    hireDate: raw.hire_date,
    baseSalary: raw.base_salary,
    allowances: raw.allowances.trim() === '' ? undefined : raw.allowances,
  });
  if (!parsed.success)
    reject(...parsed.error.issues.map((i) => describe(i.path.join('.'), i.message)));
  const data = parsed.data!;

  const codeRow = seen.firstRowWithCode.get(data.employeeCode);
  if (codeRow) reject(`employee_code: also on row ${codeRow} of this file`);
  seen.firstRowWithCode.set(data.employeeCode, rowNumber);
  const emailRow = seen.firstRowWithEmail.get(data.email);
  if (emailRow) reject(`email: also on row ${emailRow} of this file`);
  seen.firstRowWithEmail.set(data.email, rowNumber);

  if (!ctx.currencyByCountry.has(data.countryCode)) reject('country: Unsupported country');
  const owner = ctx.employeeCodeByEmail.get(data.email);
  if (owner && owner !== data.employeeCode) reject(`email: already used by ${owner}`);

  const existing = ctx.employeesByCode.get(data.employeeCode);
  return existing ? update(existing, data, ctx) : create(data, ctx);
}

function create(data: CreateEmployeeInput, ctx: RowContext): ReturnType<typeof classify> {
  if (data.hireDate > ctx.today) reject('hire_date: Hire date cannot be in the future');
  const snapshot: Snapshot = {
    baseSalary: data.baseSalary,
    allowances: data.allowances,
    currencyCode: ctx.currencyByCountry.get(data.countryCode)!,
    countryCode: data.countryCode,
    jobTitle: data.jobTitle,
    department: data.department,
  };
  const fields = ['baseSalary', 'allowances', 'jobTitle', 'department', 'countryCode'] as const;
  return {
    outcome: 'create',
    errors: [],
    employee: data,
    change: {
      // A new joiner's history starts on their own hire date, not the import's (D-036).
      changeType: 'hire',
      effectiveDate: data.hireDate,
      note: ctx.form.note,
      changes: Object.fromEntries(fields.map((f) => [f, { old: null, new: data[f] }])),
      snapshot,
    },
  };
}

function update(
  existing: ExistingEmployee,
  data: CreateEmployeeInput,
  ctx: RowContext,
): ReturnType<typeof classify> {
  const profile = Object.fromEntries(
    PROFILE_FIELDS.filter((f) => data[f] !== existing[f]).map((f) => [f, data[f]]),
  );
  const countryChanged = data.countryCode !== existing.countryCode;
  const baseChanged = !sameAmount(data.baseSalary, existing.baseSalary);
  const hireChanged = data.hireDate !== existing.hireDate;
  const auditedChanged =
    baseChanged ||
    !sameAmount(data.allowances, existing.allowances) ||
    data.jobTitle !== existing.jobTitle ||
    data.department !== existing.department ||
    countryChanged ||
    hireChanged;

  if (!auditedChanged) {
    return Object.keys(profile).length
      ? { outcome: 'update', errors: [], profile, change: null }
      : { outcome: 'unchanged', errors: [], change: null };
  }

  const correction = ctx.form.changeType === 'correction';
  if (employeeStatus(existing.lastWorkingDay, ctx.today) === 'exited' && !correction) {
    reject(
      'This employee has left: only a correction import can change pay, title, department, country or hire date',
    );
  }
  if (hireChanged && !correction)
    reject('hire_date: hire date can only change in a correction import');
  if (countryChanged && !baseChanged) {
    reject("country: relocation requires the new salary in the new country's currency");
  }

  const changeType = countryChanged ? 'relocation' : ctx.form.changeType;
  let plan: ReturnType<typeof planChange>;
  try {
    plan = planChange(
      existing,
      {
        version: existing.version,
        changeType,
        effectiveDate: ctx.form.effectiveDate,
        note: ctx.form.note,
        baseSalary: data.baseSalary,
        allowances: data.allowances,
        jobTitle: data.jobTitle,
        department: data.department,
        ...(countryChanged && { countryCode: data.countryCode }),
        ...(hireChanged && { hireDate: data.hireDate }),
      },
      {
        today: ctx.today,
        latestEffectiveDate: existing.latestEffectiveDate,
        firstNonHireDate: existing.firstNonHireDate,
        newCountryCurrency: countryChanged
          ? (ctx.currencyByCountry.get(data.countryCode) ?? null)
          : null,
      },
    );
  } catch (err) {
    if (err instanceof AppError && Array.isArray(err.details)) {
      reject(
        ...(err.details as { path: string; message: string }[]).map((d) =>
          describe(d.path, d.message),
        ),
      );
    }
    throw err;
  }
  return {
    outcome: 'update',
    errors: [],
    profile,
    updates: plan!.updates,
    change: {
      changeType,
      effectiveDate: ctx.form.effectiveDate,
      note: ctx.form.note,
      changes: plan!.changes,
      snapshot: plan!.snapshot,
    },
  };
}

/** Preview totals: every row is exactly one of create / update / unchanged / rejected. */
export function countPreview(results: RowResult[]) {
  const n = (outcome: RowResult['outcome']) => results.filter((r) => r.outcome === outcome).length;
  const counts = {
    total: results.length,
    toCreate: n('create'),
    toUpdate: n('update'),
    unchanged: n('unchanged'),
    rejected: n('rejected'),
  };
  return { ...counts, valid: counts.toCreate + counts.toUpdate + counts.unchanged };
}
