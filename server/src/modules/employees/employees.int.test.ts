import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, fixedClock } from '../../../test/app.ts';
import { signIn } from '../../../test/auth.ts';
import { resetDb, testPool } from '../../../test/db.ts';
import { withTransaction } from '../../db/transaction.ts';
import { createEmployeeSchema } from './employee.schemas.ts';
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
  baseSalary: '1800000.00',
  allowances: '120000.00',
};

let app: ReturnType<typeof buildTestApp>;
let cookie: string;

beforeEach(async () => {
  await resetDb();
  app = buildTestApp();
  ({ cookie } = await signIn(app));
});
afterAll(() => testPool.end());

const create = (body: object) =>
  request(app).post('/api/employees').set('Cookie', cookie).send(body);

const count = async (table: string) =>
  (await testPool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;

describe('POST /api/employees', () => {
  it('creates the employee and its hire change, returning 201', async () => {
    const res = await create(NEW_EMPLOYEE);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      ...NEW_EMPLOYEE,
      id: expect.any(String),
      currencyCode: 'INR',
      status: 'active',
      exitType: null,
      lastWorkingDay: null,
      version: 1,
    });
    const { rows } = await testPool.query(
      `SELECT change_type, effective_date, source, base_salary, currency_code, country_code, job_title
         FROM employee_changes WHERE employee_id = $1`,
      [res.body.id],
    );
    expect(rows).toEqual([
      {
        change_type: 'hire',
        effective_date: '2024-04-01',
        source: 'ui',
        base_salary: '1800000.00',
        currency_code: 'INR',
        country_code: 'IN',
        job_title: 'Software Engineer',
      },
    ]);
  });

  it.each([
    ['employee code', { employeeCode: 'emp-00001', email: 'other@acme.com' }, 'employeeCode'],
    ['email (any case)', { employeeCode: 'EMP-00002', email: 'ASHA.VERMA@acme.com' }, 'email'],
  ])('returns 409 DUPLICATE for a duplicate %s', async (_case, overrides, field) => {
    await create(NEW_EMPLOYEE);

    const res = await create({ ...NEW_EMPLOYEE, ...overrides });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'DUPLICATE', details: [{ path: field }] });
    expect(await count('employees')).toBe(1);
  });

  it('returns 400 with field paths for invalid input', async () => {
    const res = await create({ ...NEW_EMPLOYEE, email: 'nope', baseSalary: '-1' });

    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual([
      'email',
      'baseSalary',
    ]);
  });

  it('returns 400 for an unsupported country', async () => {
    const res = await create({ ...NEW_EMPLOYEE, countryCode: 'JP' });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      { path: 'countryCode', message: 'Unsupported country' },
    ]);
  });

  it('requires a session', async () => {
    const res = await request(app).post('/api/employees').send(NEW_EMPLOYEE);

    expect(res.status).toBe(401);
  });
});

describe('create is atomic', () => {
  it('leaves no employee behind when writing the hire change fails', async () => {
    const service = createEmployeesService({
      clock: fixedClock(),
      inTransaction: (fn) =>
        withTransaction(testPool, (client) => fn(employeeRepositories(client))),
    });
    const unknownActor = { id: randomUUID(), email: 'ghost@acme.local', name: 'Ghost' };

    const attempt = service.create(createEmployeeSchema.parse(NEW_EMPLOYEE), unknownActor);

    await expect(attempt).rejects.toThrow(/foreign key/);
    expect(await count('employees')).toBe(0);
    expect(await count('employee_changes')).toBe(0);
  });
});

describe('employee_changes is append-only', () => {
  it.each([
    ['UPDATE', "UPDATE employee_changes SET note = 'rewritten history'"],
    ['DELETE', 'DELETE FROM employee_changes'],
  ])('rejects %s at the database level', async (_case, sql) => {
    await create(NEW_EMPLOYEE);

    await expect(testPool.query(sql)).rejects.toThrow(/employee_changes is append-only/);
    expect(await count('employee_changes')).toBe(1);
  });
});
