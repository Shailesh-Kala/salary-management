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
  baseSalary: '1800000',
};

const RESIGNATION = {
  version: 1,
  exitType: 'resigned',
  noticeDate: '2026-10-01',
  lastWorkingDay: '2026-11-30',
  note: 'Moving abroad; resignation accepted',
};

let app: ReturnType<typeof buildTestApp>;
let cookie: string;
let id: string;

beforeEach(async () => {
  await resetDb();
  app = buildTestApp(); // today = 2026-10-12
  ({ cookie } = await signIn(app));
  id = (await request(app).post('/api/employees').set('Cookie', cookie).send(NEW_EMPLOYEE)).body.id;
});
afterAll(() => testPool.end());

const post = (path: string, body: object) =>
  request(app).post(`/api/employees/${id}${path}`).set('Cookie', cookie).send(body);
const listCodes = async (status: string) =>
  (await request(app).get(`/api/employees?status=${status}`).set('Cookie', cookie)).body.items.map(
    (e: { employeeCode: string }) => e.employeeCode,
  );
const historyTypes = async () =>
  (await request(app).get(`/api/employees/${id}/changes`).set('Cookie', cookie)).body.items.map(
    (c: { changeType: string }) => c.changeType,
  );

describe('POST /api/employees/:id/exit', () => {
  it('records a resignation: on notice, with an exit entry in history', async () => {
    const res = await post('/exit', RESIGNATION);

    expect(res.status).toBe(201);
    expect(res.body.employee).toMatchObject({
      exitType: 'resigned',
      noticeDate: '2026-10-01',
      lastWorkingDay: '2026-11-30',
      status: 'on_notice',
      version: 2,
    });
    expect(res.body.change).toMatchObject({
      changeType: 'exit',
      effectiveDate: '2026-10-01',
      note: RESIGNATION.note,
    });
    expect(await historyTypes()).toEqual(['exit', 'hire']);
    expect(await listCodes('on_notice')).toEqual(['EMP-00001']);
  });

  it('marks an exit whose last working day has passed as exited', async () => {
    const res = await post('/exit', {
      ...RESIGNATION,
      exitType: 'terminated',
      noticeDate: '2026-09-01',
      lastWorkingDay: '2026-09-30',
    });

    expect(res.body.employee.status).toBe('exited');
    expect(await listCodes('exited')).toEqual(['EMP-00001']);
  });

  it('rejects a stale version with 409', async () => {
    await post('/exit', RESIGNATION);

    const res = await post('/exit', RESIGNATION);

    expect(res.status).toBe(409);
  });

  it('returns 400 with the field when the dates are out of order', async () => {
    const res = await post('/exit', { ...RESIGNATION, lastWorkingDay: '2026-09-30' });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      { path: 'lastWorkingDay', message: 'Last working day must be on or after the notice date' },
    ]);
  });
});

describe('POST /api/employees/:id/exit/withdraw', () => {
  it('withdraws a resignation: active again, exit fields cleared, entry in history', async () => {
    await post('/exit', RESIGNATION);

    const res = await post('/exit/withdraw', {
      version: 2,
      note: 'Decided to stay after counter-offer',
    });

    expect(res.status).toBe(201);
    expect(res.body.employee).toMatchObject({
      exitType: null,
      noticeDate: null,
      lastWorkingDay: null,
      status: 'active',
      version: 3,
    });
    expect(res.body.change).toMatchObject({
      changeType: 'exit_withdrawn',
      effectiveDate: '2026-10-12',
    });
    expect(await historyTypes()).toEqual(['exit_withdrawn', 'exit', 'hire']);
    expect(await listCodes('active')).toEqual(['EMP-00001']);
  });

  it('returns 400 when there is nothing to withdraw', async () => {
    const res = await post('/exit/withdraw', { version: 1, note: 'Nothing to withdraw here' });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ path: '', message: 'There is no exit to withdraw' }]);
  });
});
