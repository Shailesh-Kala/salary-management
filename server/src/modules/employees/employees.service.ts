import type { Clock } from '../../lib/clock.ts';
import { AppError } from '../../lib/errors.ts';
import type { AuthUser } from '../auth/auth.service.ts';
import type { CreateEmployeeInput, ListEmployeesQuery } from './employee.schemas.ts';
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

const invalid = (path: string, message: string) =>
  new AppError('VALIDATION_ERROR', 400, 'Invalid request', [{ path, message }]);

export function createEmployeesService({ clock, repos, inTransaction }: EmployeesServiceDeps) {
  return {
    filterOptions: () => repos.employees.filterOptions(),

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
          status: employeeStatus(employee.lastWorkingDay, clock.today()),
        };
      });
    },
  };
}

export type EmployeesService = ReturnType<typeof createEmployeesService>;
