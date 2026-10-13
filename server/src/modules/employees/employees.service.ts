import type { Clock } from '../../lib/clock.ts';
import { AppError } from '../../lib/errors.ts';
import type { AuthUser } from '../auth/auth.service.ts';
import { type CurrentState, planChange, snapshotOf } from './changes.ts';
import type {
  ChangeEventInput,
  CreateEmployeeInput,
  ExitInput,
  ListEmployeesQuery,
  UpdateProfileInput,
  WithdrawExitInput,
} from './employee.schemas.ts';
import { type ExitFields, type LifecycleContext, planExit, planWithdraw } from './lifecycle.ts';
import type { EmployeeRepos } from './employees.repository.ts';
import { employeeStatus } from './status.ts';

export type EmployeesServiceDeps = {
  clock: Clock;
  /** Repositories on the pool, for reads outside a transaction. */
  repos: EmployeeRepos;
  /** Runs `fn` with repositories that share one database transaction. */
  inTransaction: <T>(fn: (repos: EmployeeRepos) => Promise<T>) => Promise<T>;
};

const AUDITED_ON_HIRE = [
  'baseSalary',
  'allowances',
  'jobTitle',
  'department',
  'countryCode',
] as const;

const notFound = () => new AppError('NOT_FOUND', 404, 'Employee not found');

const versionConflict = () =>
  new AppError(
    'VERSION_CONFLICT',
    409,
    'This employee was changed by someone else. Reload to see the latest details.',
  );

const invalid = (path: string, message: string) =>
  new AppError('VALIDATION_ERROR', 400, 'Invalid request', [{ path, message }]);

type LifecyclePlan = {
  exit: ExitFields;
  changes: Record<string, { old: unknown; new: unknown }>;
  effectiveDate: string;
};

export function createEmployeesService({ clock, repos, inTransaction }: EmployeesServiceDeps) {
  const withStatus = <T extends { lastWorkingDay: string | null }>(e: T) => ({
    ...e,
    status: employeeStatus(e.lastWorkingDay, clock.today()),
  });

  /** Locks the employee, checks the version, applies the exit plan and records it in history. */
  const applyLifecycle = (
    id: string,
    input: { version: number; note: string },
    changeType: 'exit' | 'exit_withdrawn',
    actor: AuthUser,
    plan: (current: CurrentState, ctx: LifecycleContext) => LifecyclePlan,
  ) =>
    inTransaction(async ({ employees, changes }) => {
      const current = await employees.findForUpdate(id);
      if (!current) throw notFound();
      if (current.version !== input.version) throw versionConflict();

      const { latest } = await changes.dateBounds(id);
      const result = plan(current, { today: clock.today(), latestEffectiveDate: latest });
      const employee = await employees.setExit(id, result.exit, clock.now());
      const change = await changes.insert({
        employeeId: id,
        changeType,
        effectiveDate: result.effectiveDate,
        note: input.note,
        source: 'ui',
        changes: result.changes,
        snapshot: snapshotOf(current),
        changedBy: actor.id,
        changedAt: clock.now(),
      });
      return { employee: withStatus(employee), change };
    });

  return {
    recordExit: (id: string, input: ExitInput, actor: AuthUser) =>
      applyLifecycle(id, input, 'exit', actor, (current, ctx) => planExit(current, input, ctx)),

    withdrawExit: (id: string, input: WithdrawExitInput, actor: AuthUser) =>
      applyLifecycle(id, input, 'exit_withdrawn', actor, planWithdraw),

    filterOptions: () => repos.employees.filterOptions(),

    async get(id: string) {
      const employee = await repos.employees.findById(id);
      if (!employee) throw notFound();
      return { ...employee, status: employeeStatus(employee.lastWorkingDay, clock.today()) };
    },

    async updateProfile(id: string, { version, ...fields }: UpdateProfileInput) {
      const updated = await repos.employees.updateProfile(id, version, fields, clock.now());
      if (updated)
        return { ...updated, status: employeeStatus(updated.lastWorkingDay, clock.today()) };
      if (await repos.employees.findById(id)) throw versionConflict();
      throw notFound();
    },

    /** Applies an audited change event and records it in history, in one transaction. */
    recordChange(id: string, input: ChangeEventInput, actor: AuthUser) {
      return inTransaction(async ({ employees, changes }) => {
        const current = await employees.findForUpdate(id);
        if (!current) throw notFound();
        if (current.version !== input.version) throw versionConflict();

        const bounds = await changes.dateBounds(id);
        const target =
          input.changeType === 'relocation' && input.countryCode
            ? await employees.findCountry(input.countryCode)
            : null;
        const plan = planChange(current, input, {
          today: clock.today(),
          latestEffectiveDate: bounds.latest,
          firstNonHireDate: bounds.firstNonHire,
          newCountryCurrency: target?.currencyCode ?? null,
        });

        const employee = await employees.applyChange(id, plan.updates, clock.now());
        const change = await changes.insert({
          employeeId: id,
          changeType: input.changeType,
          effectiveDate: input.effectiveDate,
          note: input.note,
          source: 'ui',
          changes: plan.changes,
          snapshot: plan.snapshot,
          changedBy: actor.id,
          changedAt: clock.now(),
        });
        return {
          employee: { ...employee, status: employeeStatus(employee.lastWorkingDay, clock.today()) },
          change,
        };
      });
    },

    async history(id: string) {
      if (!(await repos.employees.findById(id))) throw notFound();
      return { items: await repos.changes.listForEmployee(id) };
    },

    async list(query: ListEmployeesQuery) {
      const rates = await repos.employees.ratesInfo(query.currency);
      if (!rates.known) throw invalid('currency', 'Unknown currency');
      const { items, total } = await repos.employees.list(query, clock.today());
      const { page, pageSize, currency } = query;
      return { items, total, page, pageSize, currency, ratesAsOf: rates.asOf };
    },

    async create(input: CreateEmployeeInput, actor: AuthUser) {
      if (input.hireDate > clock.today()) {
        throw invalid('hireDate', 'Hire date cannot be in the future');
      }

      return inTransaction(async ({ employees, changes }) => {
        const country = await employees.findCountry(input.countryCode);
        if (!country) throw invalid('countryCode', 'Unsupported country');

        const { note = 'Employee record created', ...fields } = input;
        const employee = await employees.insert(fields);
        await changes.insert({
          employeeId: employee.id,
          changeType: 'hire',
          effectiveDate: input.hireDate,
          note,
          source: 'ui',
          changes: Object.fromEntries(
            AUDITED_ON_HIRE.map((f) => [f, { old: null, new: input[f] }]),
          ),
          snapshot: {
            baseSalary: input.baseSalary,
            allowances: input.allowances,
            currencyCode: country.currencyCode,
            countryCode: input.countryCode,
            jobTitle: input.jobTitle,
            department: input.department,
          },
          changedBy: actor.id,
          changedAt: clock.now(),
        });

        return {
          ...employee,
          currencyCode: country.currencyCode,
          countryName: country.name,
          status: employeeStatus(employee.lastWorkingDay, clock.today()),
        };
      });
    },
  };
}

export type EmployeesService = ReturnType<typeof createEmployeesService>;
