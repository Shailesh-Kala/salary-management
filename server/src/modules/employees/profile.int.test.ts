import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../../../test/app.ts';
import { signIn } from '../../../test/auth.ts';
import { resetDb, testPool } from '../../../test/db.ts';

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
};

let app: ReturnType<typeof buildTestApp>;
let cookie: string;
let id: string;

beforeEach(async () => {
  await resetDb();
  app = buildTestApp();
  ({ cookie } = await signIn(app));
  const res = await request(app).post('/api/employees').set('Cookie', cookie).send(NEW_EMPLOYEE);
  id = res.body.id;
});
afterAll(() => testPool.end());

const get = (employeeId = id) =>
  request(app).get(`/api/employees/${employeeId}`).set('Cookie', cookie);
const patch = (body: object, employeeId = id) =>
  request(app).patch(`/api/employees/${employeeId}`).set('Cookie', cookie).send(body);
const changeCount = async () =>
  (await testPool.query('SELECT count(*)::int AS n FROM employee_changes')).rows[0].n;

describe('GET /api/employees/:id', () => {
  it('returns the employee with version, derived status, currency and country name', async () => {
    const res = await get();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ...NEW_EMPLOYEE,
      id,
      allowances: '0.00',
      version: 1,
      status: 'active',
      currencyCode: 'INR',
      countryName: 'India',
      exitType: null,
      noticeDate: null,
      lastWorkingDay: null,
    });
  });

  it.each([
    ['an unknown id', randomUUID()],
    ['a malformed id', 'not-a-uuid'],
  ])('returns 404 for %s', async (_case, employeeId) => {
    const res = await get(employeeId);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND', message: 'Employee not found' });
  });
});

describe('PATCH /api/employees/:id', () => {
  it('updates name and email, bumps the version and writes no history entry', async () => {
    const res = await patch({ version: 1, firstName: 'Asha Rani', email: ' Asha.Rani@ACME.com ' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      firstName: 'Asha Rani',
      lastName: 'Verma',
      email: 'asha.rani@acme.com',
      version: 2,
      status: 'active',
    });
    expect((await get()).body.version).toBe(2);
    expect(await changeCount()).toBe(1); // only the hire entry
  });

  it('rejects a stale version with 409 and keeps the newer data', async () => {
    await patch({ version: 1, lastName: 'Sharma' });

    const res = await patch({ version: 1, lastName: 'Iyer' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('VERSION_CONFLICT');
    expect((await get()).body).toMatchObject({ lastName: 'Sharma', version: 2 });
  });

  it('returns 404 for an unknown employee', async () => {
    const res = await patch({ version: 1, firstName: 'X' }, randomUUID());

    expect(res.status).toBe(404);
  });

  it.each([
    ['baseSalary', '2000000'],
    ['allowances', '1000'],
    ['jobTitle', 'Senior Software Engineer'],
    ['department', 'Product'],
    ['countryCode', 'US'],
    ['hireDate', '2024-01-01'],
  ])('refuses to change %s here (audited fields need a change event)', async (field, value) => {
    const res = await patch({ version: 1, [field]: value });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect((await get()).body.version).toBe(1);
  });

  it('returns 409 DUPLICATE when the email belongs to another employee', async () => {
    await request(app)
      .post('/api/employees')
      .set('Cookie', cookie)
      .send({ ...NEW_EMPLOYEE, employeeCode: 'EMP-00002', email: 'ben@acme.com' });

    const res = await patch({ version: 1, email: 'BEN@acme.com' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'DUPLICATE', details: [{ path: 'email' }] });
  });

  it.each([
    ['nothing to change', { version: 1 }, ''],
    ['no version', { firstName: 'Asha' }, 'version'],
  ])('returns 400 for %s', async (_case, body, path) => {
    const res = await patch(body);

    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual([path]);
  });
});
