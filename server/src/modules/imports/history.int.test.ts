import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, fixedClock, type TestClock } from '../../../test/app.ts';
import { signIn } from '../../../test/auth.ts';
import { resetDb, testPool } from '../../../test/db.ts';

const FILE = [
  'employee_code,first_name,last_name,email,job_title,department,country,hire_date,base_salary,allowances',
  'EMP-1,Asha,Verma,asha@acme.com,Software Engineer,Engineering,IN,2024-04-01,1800000,200000',
].join('\n');

let app: ReturnType<typeof buildTestApp>;
let cookie: string;
let clock: TestClock;

beforeEach(async () => {
  await resetDb();
  clock = fixedClock();
  app = buildTestApp({ clock });
  ({ cookie } = await signIn(app));
});
afterAll(() => testPool.end());

async function uploadAndCancel(name: string) {
  const req = request(app).post('/api/imports').set('Cookie', cookie);
  req
    .field('changeType', 'annual_review')
    .field('effectiveDate', '2026-10-01')
    .field('note', 'FY26');
  const { body } = await req.attach('file', Buffer.from(FILE), name);
  await request(app).post(`/api/imports/${body.id}/cancel`).set('Cookie', cookie);
  return body.id as string;
}

describe('GET /api/imports', () => {
  it('lists imports newest first, a page at a time', async () => {
    await uploadAndCancel('first.csv');
    clock.advance(60_000);
    const latest = await uploadAndCancel('second.csv');

    const res = await request(app).get('/api/imports?pageSize=1').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect(res.body.items).toEqual([
      {
        id: latest,
        status: 'cancelled',
        fileName: 'second.csv',
        changeType: 'annual_review',
        effectiveDate: '2026-10-01',
        rowCount: 1,
        counts: null,
        createdAt: '2026-10-12T09:01:00.000Z',
        finishedAt: '2026-10-12T09:01:00.000Z',
        uploadedBy: { id: expect.any(String), name: 'HR Manager' },
      },
    ]);
  });

  it('requires a session', async () => {
    expect((await request(app).get('/api/imports')).status).toBe(401);
  });
});
