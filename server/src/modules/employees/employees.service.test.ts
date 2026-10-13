import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../test/app.ts';
import { AppError } from '../../lib/errors.ts';
import { createEmployeeSchema } from '../../shared/employee-rules.ts';
import type { EmployeeRepos } from './employees.repository.ts';
import { createEmployeesService } from './employees.service.ts';

const actor = { id: 'user-1', email: 'hr@acme.local', name: 'HR' };
const input = createEmployeeSchema.parse({
  employeeCode: 'EMP-00001',
  firstName: 'Asha',
  lastName: 'Verma',
  email: 'asha@acme.com',
  jobTitle: 'Software Engineer',
  department: 'Engineering',
  countryCode: 'IN',
  hireDate: '2024-04-01',
  baseSalary: '1800000',
  allowances: '120000',
});

function setup() {
  const written = { employees: [] as unknown[], changes: [] as unknown[] };
  const repos = {
    employees: {
      findCountry: async (code: string) =>
        code === 'IN' ? { code: 'IN', currencyCode: 'INR' } : null,
      insert: async (row: object) => {
        written.employees.push(row);
        return {
          id: 'emp-1',
          ...row,
          exitType: null,
          noticeDate: null,
          lastWorkingDay: null,
          version: 1,
        };
      },
    },
    changes: {
      insert: async (row: object) => {
        written.changes.push(row);
      },
    },
  } as unknown as EmployeeRepos;
  const clock = fixedClock('2026-10-12T09:00:00Z');
  const service = createEmployeesService({ clock, repos, inTransaction: (fn) => fn(repos) });
  return { service, written, clock };
}

describe('employeesService.create', () => {
  it('creates the employee with derived currency and status', async () => {
    const { service } = setup();

    const employee = await service.create(input, actor);

    expect(employee).toMatchObject({
      id: 'emp-1',
      employeeCode: 'EMP-00001',
      currencyCode: 'INR',
      status: 'active',
      version: 1,
    });
  });

  it('records a hire change effective on the hire date with a full snapshot', async () => {
    const { service, written, clock } = setup();

    await service.create(input, actor);

    expect(written.changes).toEqual([
      {
        employeeId: 'emp-1',
        changeType: 'hire',
        effectiveDate: '2024-04-01',
        note: 'Employee record created',
        source: 'ui',
        changes: {
          baseSalary: { old: null, new: '1800000' },
          allowances: { old: null, new: '120000' },
          jobTitle: { old: null, new: 'Software Engineer' },
          department: { old: null, new: 'Engineering' },
          countryCode: { old: null, new: 'IN' },
        },
        snapshot: {
          baseSalary: '1800000',
          allowances: '120000',
          currencyCode: 'INR',
          countryCode: 'IN',
          jobTitle: 'Software Engineer',
          department: 'Engineering',
        },
        changedBy: 'user-1',
        changedAt: clock.now(),
      },
    ]);
  });

  it('uses the note given by HR', async () => {
    const { service, written } = setup();

    await service.create({ ...input, note: 'Joined from the campus programme' }, actor);

    expect(written.changes[0]).toMatchObject({ note: 'Joined from the campus programme' });
  });

  it('rejects an unsupported country without writing anything', async () => {
    const { service, written } = setup();

    const attempt = service.create({ ...input, countryCode: 'JP' }, actor);

    await expect(attempt).rejects.toEqual(
      new AppError('VALIDATION_ERROR', 400, 'Invalid request', [
        { path: 'countryCode', message: 'Unsupported country' },
      ]),
    );
    expect(written).toEqual({ employees: [], changes: [] });
  });

  it('rejects a hire date after today (in the org time zone)', async () => {
    const { service, written } = setup();

    const attempt = service.create({ ...input, hireDate: '2026-10-13' }, actor);

    await expect(attempt).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ path: 'hireDate', message: 'Hire date cannot be in the future' }],
    });
    expect(written.employees).toEqual([]);
  });
});
