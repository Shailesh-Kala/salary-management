import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../../../test/app.ts';
import { signIn } from '../../../test/auth.ts';
import { resetDb, testPool } from '../../../test/db.ts';
import { insertEmployee } from '../../../test/factories.ts';

// Today is 2026-10-12. Annual salary = base + allowances. Rates: USD 88.75, EUR 103.20 (INR per unit).
//   EMP-1  IN  Engineering   2,000,000 INR                        active
//   EMP-2  IN  Engineering   1,000,000 INR                        active
//   EMP-3  IN  Sales           900,000 INR                        on notice (still counted)
//   EMP-4  US  Engineering     160,000 USD = 14,200,000 INR       active
//   EMP-5  FR  Sales            60,000 EUR =  6,192,000 INR       active
//   EMP-6  GB  Finance          50,000 GBP                        exited (excluded)
let app: ReturnType<typeof buildTestApp>;
let cookie: string;

beforeAll(async () => {
  await resetDb();
  app = buildTestApp();
  ({ cookie } = await signIn(app));
  const add = (n: number, overrides: object) =>
    insertEmployee({ employeeCode: `EMP-${n}`, email: `e${n}@acme.com`, ...overrides });
  await add(1, { baseSalary: '1800000', allowances: '200000' });
  await add(2, { baseSalary: '1000000' });
  await add(3, {
    department: 'Sales',
    baseSalary: '900000',
    exitType: 'resigned',
    noticeDate: '2026-10-01',
    lastWorkingDay: '2026-11-30',
  });
  await add(4, { countryCode: 'US', baseSalary: '150000', allowances: '10000' });
  await add(5, { countryCode: 'FR', department: 'Sales', baseSalary: '60000' });
  await add(6, {
    countryCode: 'GB',
    department: 'Finance',
    baseSalary: '50000',
    exitType: 'resigned',
    noticeDate: '2026-08-01',
    lastWorkingDay: '2026-09-30',
  });
});
afterAll(() => testPool.end());

const insights = (path: string) => request(app).get(`/api/insights${path}`).set('Cookie', cookie);

describe('GET /api/insights/summary (Q1)', () => {
  it('counts current headcount and totals pay in INR, excluding leavers', async () => {
    const res = await insights('/summary');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      currency: 'INR',
      ratesAsOf: '2026-10-01',
      headcount: 5,
      totalPayroll: '24292000.00',
      averageSalary: '4858400.00',
      medianSalary: '2000000.00',
    });
  });

  it('converts to the reporting currency, rounding only the final figures', async () => {
    const res = await insights('/summary?currency=USD');

    expect(res.body).toMatchObject({
      currency: 'USD',
      totalPayroll: '273712.68', // 24,292,000 ÷ 88.75
      averageSalary: '54742.54', // 4,858,400 ÷ 88.75
      medianSalary: '22535.21', // 2,000,000 ÷ 88.75
    });
  });

  it.each([
    [
      '?country=IN',
      {
        headcount: 3,
        totalPayroll: '3900000.00',
        averageSalary: '1300000.00',
        medianSalary: '1000000.00',
      },
    ],
    [
      '?department=Engineering',
      {
        headcount: 3,
        totalPayroll: '17200000.00',
        averageSalary: '5733333.33',
        medianSalary: '2000000.00',
      },
    ],
    [
      '?country=IN&department=Sales',
      { headcount: 1, totalPayroll: '900000.00', medianSalary: '900000.00' },
    ],
    [
      '?country=GB',
      { headcount: 0, totalPayroll: '0.00', averageSalary: null, medianSalary: null },
    ],
  ])('filters with %s', async (query, expected) => {
    expect((await insights(`/summary${query}`)).body).toMatchObject(expected);
  });

  it('rejects an unknown currency', async () => {
    const res = await insights('/summary?currency=XYZ');

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ path: 'currency', message: 'Unknown currency' }]);
  });
});

describe('GET /api/insights/by-country (Q2)', () => {
  it('gives min / median / average / max / total per country in local and reporting currency', async () => {
    const res = await insights('/by-country');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ currency: 'INR', ratesAsOf: '2026-10-01' });
    expect(res.body.items).toEqual([
      {
        countryCode: 'FR',
        countryName: 'France',
        currencyCode: 'EUR',
        headcount: 1,
        local: {
          min: '60000.00',
          median: '60000.00',
          average: '60000.00',
          max: '60000.00',
          total: '60000.00',
        },
        converted: {
          min: '6192000.00',
          median: '6192000.00',
          average: '6192000.00',
          max: '6192000.00',
          total: '6192000.00',
        },
      },
      {
        countryCode: 'IN',
        countryName: 'India',
        currencyCode: 'INR',
        headcount: 3,
        local: {
          min: '900000.00',
          median: '1000000.00',
          average: '1300000.00',
          max: '2000000.00',
          total: '3900000.00',
        },
        converted: {
          min: '900000.00',
          median: '1000000.00',
          average: '1300000.00',
          max: '2000000.00',
          total: '3900000.00',
        },
      },
      {
        countryCode: 'US',
        countryName: 'United States',
        currencyCode: 'USD',
        headcount: 1,
        local: {
          min: '160000.00',
          median: '160000.00',
          average: '160000.00',
          max: '160000.00',
          total: '160000.00',
        },
        converted: {
          min: '14200000.00',
          median: '14200000.00',
          average: '14200000.00',
          max: '14200000.00',
          total: '14200000.00',
        },
      },
    ]);
  });

  it('applies the department filter', async () => {
    const res = await insights('/by-country?department=Sales');

    expect(
      res.body.items.map((c: { countryCode: string; headcount: number }) => [
        c.countryCode,
        c.headcount,
      ]),
    ).toEqual([
      ['FR', 1],
      ['IN', 1],
    ]);
  });
});

describe('GET /api/insights/by-department (Q3)', () => {
  it('ranks departments by total payroll in the reporting currency', async () => {
    const res = await insights('/by-department');

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      {
        department: 'Engineering',
        headcount: 3,
        totalPayroll: '17200000.00',
        medianSalary: '2000000.00',
        averageSalary: '5733333.33',
      },
      {
        department: 'Sales',
        headcount: 2,
        totalPayroll: '7092000.00',
        medianSalary: '3546000.00',
        averageSalary: '3546000.00',
      },
    ]);
  });

  it('applies the country filter', async () => {
    const res = await insights('/by-department?country=IN');

    expect(res.body.items).toEqual([
      {
        department: 'Engineering',
        headcount: 2,
        totalPayroll: '3000000.00',
        medianSalary: '1500000.00',
        averageSalary: '1500000.00',
      },
      {
        department: 'Sales',
        headcount: 1,
        totalPayroll: '900000.00',
        medianSalary: '900000.00',
        averageSalary: '900000.00',
      },
    ]);
  });
});
