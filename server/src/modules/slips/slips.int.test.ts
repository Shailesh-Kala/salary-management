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
  baseSalary: '1800000',
  allowances: '200000',
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

const slip = (month: string, employeeId = id) =>
  request(app).get(`/api/employees/${employeeId}/slips/${month}`).set('Cookie', cookie);
const recordChange = (body: object) =>
  request(app)
    .post(`/api/employees/${id}/changes`)
    .set('Cookie', cookie)
    .send({ version: 1, ...body });
const base = (res: request.Response) => res.body.earnings[0].amount;

describe('GET /api/employees/:id/slips/:month', () => {
  it('returns gross pay from the salary in effect at the end of that month', async () => {
    await recordChange({
      changeType: 'promotion',
      effectiveDate: '2026-09-01',
      note: 'Promoted to senior',
      jobTitle: 'Senior Software Engineer',
      baseSalary: '2400000',
    });

    const august = await slip('2026-08');
    const september = await slip('2026-09');

    expect(august.status).toBe(200);
    expect(august.body).toMatchObject({ jobTitle: 'Software Engineer', grossPay: '166666.67' });
    expect(base(august)).toBe('150000.00');
    expect(september.body).toMatchObject({
      jobTitle: 'Senior Software Engineer',
      grossPay: '216666.67',
    });
    expect(base(september)).toBe('200000.00');
  });

  it('keeps the old country and currency for months before a relocation (T14)', async () => {
    await recordChange({
      changeType: 'relocation',
      effectiveDate: '2026-08-15',
      note: 'Moved to the New York office',
      countryCode: 'US',
      baseSalary: '150000',
      allowances: '10000',
    });

    const july = await slip('2026-07');
    const august = await slip('2026-08');

    expect(july.body).toMatchObject({
      countryName: 'India',
      currencyCode: 'INR',
      grossPay: '166666.67',
    });
    expect(august.body).toMatchObject({
      countryName: 'United States',
      currencyCode: 'USD',
      grossPay: '13333.33',
    });
  });

  it('uses the earliest snapshot for months before it after the hire date is corrected earlier', async () => {
    await recordChange({
      changeType: 'correction',
      effectiveDate: '2026-10-12',
      note: 'Joining date was entered wrongly',
      hireDate: '2024-02-01',
    });

    const res = await slip('2024-03');

    expect(res.status).toBe(200);
    expect(base(res)).toBe('150000.00');
  });

  it.each([
    ['a future month', '2026-11', 'Slips can only be generated for the current or past months'],
    ['a month before hire', '2024-03', 'Asha Verma joined on 2024-04-01'],
    ['a malformed month', '2026-13', 'Use a month like 2026-09'],
  ])('returns 400 for %s', async (_case, month, message) => {
    const res = await slip(month);

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ path: 'month', message }]);
  });

  it('returns 404 for an unknown employee', async () => {
    expect((await slip('2026-09', randomUUID())).status).toBe(404);
  });
});
