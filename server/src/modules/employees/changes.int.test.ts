import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, fixedClock } from '../../../test/app.ts';
import { signIn } from '../../../test/auth.ts';
import { resetDb, testPool } from '../../../test/db.ts';
import { withTransaction } from '../../db/transaction.ts';
import { employeeRepositories } from './employees.repository.ts';
import { createEmployeesService } from './employees.service.ts';

const NEW_EMPLOYEE = {
  employeeCode: 'EMP-00001',
  firstName: 'Asha',
  lastName: 'Verma',
  email: 'asha.verma@acme.com',
  jobTitle: 'Software Engineer',
  department: 'Engineering',
  countryCode: 'IN',
  hireDate: '2024-04-01',
  baseSalary: '1800000',
  allowances: '200000',
};

const PROMOTION = {
  version: 1,
  changeType: 'promotion',
  effectiveDate: '2026-10-01',
  note: 'Led the payments migration; promoted after review',
  jobTitle: 'Senior Software Engineer',
  baseSalary: '2400000',
};

let app: ReturnType<typeof buildTestApp>;
let cookie: string;
let id: string;

beforeEach(async () => {
  await resetDb();
  app = buildTestApp();
  ({ cookie } = await signIn(app));
  id = (await request(app).post('/api/employees').set('Cookie', cookie).send(NEW_EMPLOYEE)).body.id;
});
afterAll(() => testPool.end());

const record = (body: object, employeeId = id) =>
  request(app).post(`/api/employees/${employeeId}/changes`).set('Cookie', cookie).send(body);
const history = (employeeId = id) =>
  request(app).get(`/api/employees/${employeeId}/changes`).set('Cookie', cookie);
const employeeRow = async () =>
  (
    await testPool.query(
      'SELECT version, job_title, base_salary, country_code FROM employees WHERE id = $1',
      [id],
    )
  ).rows[0];

describe('POST /api/employees/:id/changes', () => {
  it('applies a promotion and records it as one change, returning both', async () => {
    const res = await record(PROMOTION);

    expect(res.status).toBe(201);
    expect(res.body.employee).toMatchObject({
      jobTitle: 'Senior Software Engineer',
      baseSalary: '2400000.00',
      version: 2,
      status: 'active',
    });
    expect(res.body.change).toMatchObject({
      changeType: 'promotion',
      effectiveDate: '2026-10-01',
      note: PROMOTION.note,
      changes: {
        jobTitle: { old: 'Software Engineer', new: 'Senior Software Engineer' },
        baseSalary: { old: '1800000.00', new: '2400000' },
      },
    });
    expect(await employeeRow()).toEqual({
      version: 2,
      job_title: 'Senior Software Engineer',
      base_salary: '2400000.00',
      country_code: 'IN',
    });
  });

  it('rejects a stale version with 409 and applies nothing', async () => {
    await record(PROMOTION);

    const res = await record({ ...PROMOTION, baseSalary: '2500000' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('VERSION_CONFLICT');
    expect((await employeeRow()).base_salary).toBe('2400000.00');
    expect((await history()).body.items).toHaveLength(2);
  });

  it('relocates with the new pay in the new currency, keeping old history in the old one (T14)', async () => {
    const res = await record({
      version: 1,
      changeType: 'relocation',
      effectiveDate: '2026-09-01',
      note: 'Moved to the New York office',
      countryCode: 'US',
      baseSalary: '150000',
      allowances: '10000',
    });

    expect(res.status).toBe(201);
    expect(res.body.employee).toMatchObject({
      countryCode: 'US',
      currencyCode: 'USD',
      countryName: 'United States',
    });
    expect(res.body.change.changes.countryCode).toEqual({ old: 'IN', new: 'US' });
    const { rows } = await testPool.query(
      `SELECT change_type, currency_code, country_code, base_salary FROM employee_changes
        WHERE employee_id = $1 ORDER BY id`,
      [id],
    );
    expect(rows).toEqual([
      { change_type: 'hire', currency_code: 'INR', country_code: 'IN', base_salary: '1800000.00' },
      {
        change_type: 'relocation',
        currency_code: 'USD',
        country_code: 'US',
        base_salary: '150000.00',
      },
    ]);
  });

  it('returns 400 with the field for a rule violation', async () => {
    const res = await record({ ...PROMOTION, effectiveDate: '2024-03-01' });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      {
        path: 'effectiveDate',
        message: 'Effective date must be on or after 2024-04-01 (the latest change)',
      },
    ]);
  });

  it('returns 404 for an unknown employee', async () => {
    expect((await record(PROMOTION, randomUUID())).status).toBe(404);
  });

  it('leaves the employee untouched when writing the change fails', async () => {
    const service = createEmployeesService({
      clock: fixedClock(),
      repos: employeeRepositories(testPool),
      inTransaction: (fn) =>
        withTransaction(testPool, (client) => fn(employeeRepositories(client))),
    });
    const ghost = { id: randomUUID(), email: 'ghost@acme.local', name: 'Ghost' };

    await expect(
      service.recordChange(id, { ...PROMOTION, changeType: 'promotion' }, ghost),
    ).rejects.toThrow(/foreign key/);
    expect(await employeeRow()).toMatchObject({ version: 1, job_title: 'Software Engineer' });
  });
});

describe('GET /api/employees/:id/changes', () => {
  it('lists the history newest first with who made each change', async () => {
    await record(PROMOTION);

    const res = await history();

    expect(res.status).toBe(200);
    expect(res.body.items.map((c: { changeType: string }) => c.changeType)).toEqual([
      'promotion',
      'hire',
    ]);
    expect(res.body.items[0]).toEqual({
      id: expect.any(String),
      changeType: 'promotion',
      effectiveDate: '2026-10-01',
      note: PROMOTION.note,
      source: 'ui',
      changes: {
        jobTitle: { old: 'Software Engineer', new: 'Senior Software Engineer' },
        baseSalary: { old: '1800000.00', new: '2400000' },
      },
      snapshot: {
        baseSalary: '2400000.00',
        allowances: '200000.00',
        currencyCode: 'INR',
        countryCode: 'IN',
        jobTitle: 'Senior Software Engineer',
        department: 'Engineering',
      },
      changedBy: { id: expect.any(String), name: 'HR Manager' },
      changedAt: '2026-10-12T09:00:00.000Z',
    });
  });

  it('returns 404 for an unknown employee', async () => {
    expect((await history(randomUUID())).status).toBe(404);
  });
});
