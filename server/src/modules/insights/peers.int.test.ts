import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../../../test/app.ts';
import { signIn } from '../../../test/auth.ts';
import { resetDb, testPool } from '../../../test/db.ts';
import { insertEmployee } from '../../../test/factories.ts';

// Today is 2026-10-12. Peers = same job title and country (current headcount only).
//   Software Engineer, IN:  EMP-1 1,000,000 · EMP-2 1,200,000 · EMP-3 1,500,000 · EMP-4 3,000,000  → median 1,350,000
//   Account Executive, IN:  EMP-5   800,000 · EMP-6   900,000 (on notice) · EMP-7 1,000,000       → median   900,000
//                           EMP-8   300,000 exited — excluded
//   Software Engineer, US:  EMP-9   150,000 · EMP-10  160,000 (USD)                               → median   155,000
let app: ReturnType<typeof buildTestApp>;
let cookie: string;

beforeAll(async () => {
  await resetDb();
  app = buildTestApp();
  ({ cookie } = await signIn(app));
  const add = (n: number, salary: string, overrides: object = {}) =>
    insertEmployee({
      employeeCode: `EMP-${n}`,
      email: `e${n}@acme.com`,
      firstName: `First${n}`,
      lastName: `Last${n}`,
      baseSalary: salary,
      ...overrides,
    });
  const ae = { jobTitle: 'Account Executive', department: 'Sales' };
  await add(1, '1000000');
  await add(2, '1200000');
  await add(3, '1500000');
  await add(4, '3000000');
  await add(5, '800000', ae);
  await add(6, '900000', {
    ...ae,
    exitType: 'resigned',
    noticeDate: '2026-10-01',
    lastWorkingDay: '2026-11-30',
  });
  await add(7, '1000000', ae);
  await add(8, '300000', {
    ...ae,
    exitType: 'terminated',
    noticeDate: '2026-08-01',
    lastWorkingDay: '2026-09-30',
  });
  await add(9, '150000', { countryCode: 'US' });
  await add(10, '160000', { countryCode: 'US' });
});
afterAll(() => testPool.end());

const insights = (path: string) => request(app).get(`/api/insights${path}`).set('Cookie', cookie);
const codes = (res: request.Response) =>
  res.body.items.map((o: { employeeCode: string }) => o.employeeCode);

describe('GET /api/insights/by-job-title (Q4)', () => {
  it('gives min / median / max per job title in the country currency', async () => {
    const res = await insights('/by-job-title?country=IN');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      country: 'IN',
      currencyCode: 'INR',
      items: [
        {
          jobTitle: 'Account Executive',
          headcount: 3,
          min: '800000.00',
          median: '900000.00',
          max: '1000000.00',
        },
        {
          jobTitle: 'Software Engineer',
          headcount: 4,
          min: '1000000.00',
          median: '1350000.00',
          max: '3000000.00',
        },
      ],
    });
  });

  it('works for another country in its own currency', async () => {
    const res = await insights('/by-job-title?country=US');

    expect(res.body).toMatchObject({
      currencyCode: 'USD',
      items: [
        {
          jobTitle: 'Software Engineer',
          headcount: 2,
          min: '150000.00',
          median: '155000.00',
          max: '160000.00',
        },
      ],
    });
  });

  it.each([
    ['no country', '', 'country'],
    ['an unsupported country', '?country=JP', 'country'],
  ])('returns 400 for %s', async (_case, query, path) => {
    const res = await insights(`/by-job-title${query}`);

    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual([path]);
  });
});

describe('GET /api/insights/outliers (Q5)', () => {
  it('flags pay below 80% or above 120% of the peer median, most extreme first', async () => {
    const res = await insights('/outliers');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ low: 0.8, high: 1.2, total: 2, page: 1, pageSize: 25 });
    expect(res.body.items).toEqual([
      {
        id: expect.any(String),
        employeeCode: 'EMP-4',
        firstName: 'First4',
        lastName: 'Last4',
        jobTitle: 'Software Engineer',
        department: 'Engineering',
        countryCode: 'IN',
        currencyCode: 'INR',
        annualSalary: '3000000.00',
        peerMedian: '1350000.00',
        peerCount: 4,
        ratio: '2.22',
        position: 'above',
      },
      expect.objectContaining({ employeeCode: 'EMP-1', ratio: '0.74', position: 'below' }),
    ]);
  });

  it('uses custom thresholds, ordering ties by employee code', async () => {
    const res = await insights('/outliers?low=0.95&high=1.05');

    expect(res.body.total).toBe(6);
    expect(codes(res)).toEqual(['EMP-4', 'EMP-1', 'EMP-2', 'EMP-5', 'EMP-3', 'EMP-7']);
  });

  it('paginates', async () => {
    const res = await insights('/outliers?low=0.95&high=1.05&pageSize=2&page=2');

    expect(res.body).toMatchObject({ total: 6, page: 2, pageSize: 2 });
    expect(codes(res)).toEqual(['EMP-2', 'EMP-5']);
  });

  it('filters who is listed without changing the peer medians', async () => {
    const res = await insights('/outliers?low=0.95&high=1.05&department=Sales');

    expect(codes(res)).toEqual(['EMP-5', 'EMP-7']);
    expect(res.body.items[0].peerMedian).toBe('900000.00');
  });

  it.each([
    ['low above 1', '?low=1.3', 'low'],
    ['high below 1', '?high=0.9', 'high'],
  ])('returns 400 for %s', async (_case, query, path) => {
    const res = await insights(`/outliers${query}`);

    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual([path]);
  });
});
