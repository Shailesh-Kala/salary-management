import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../../../test/app.ts';
import { signIn } from '../../../test/auth.ts';
import { resetDb, testPool } from '../../../test/db.ts';
import { insertEmployee } from '../../../test/factories.ts';
import { employeeStatus } from './status.ts';

// Clock: 2026-10-12 in Asia/Kolkata. Annual salary = base + allowances.
//   EMP-001 Asha Verma    IN Engineering Software Engineer 2,000,000 INR              active
//   EMP-002 Ben Carter    US Engineering Software Engineer   160,000 USD = 14,200,000 INR active
//   EMP-003 Chloe Martin  FR Sales       Account Executive    60,000 EUR =  6,192,000 INR active
//   EMP-004 Dev Patel     IN Sales       Account Executive   900,000 INR              on notice
//   EMP-005 Emma Brown    GB Finance     Analyst              50,000 GBP =  5,920,000 INR exited
const TODAY = '2026-10-12';

let app: ReturnType<typeof buildTestApp>;
let cookie: string;

beforeAll(async () => {
  await resetDb();
  app = buildTestApp();
  ({ cookie } = await signIn(app));
  await insertEmployee({ baseSalary: '1800000', allowances: '200000' });
  await insertEmployee({
    employeeCode: 'EMP-002',
    firstName: 'Ben',
    lastName: 'Carter',
    email: 'ben.carter@acme.com',
    countryCode: 'US',
    baseSalary: '150000',
    allowances: '10000',
  });
  await insertEmployee({
    employeeCode: 'EMP-003',
    firstName: 'Chloe',
    lastName: 'Martin',
    email: 'chloe.martin@acme.com',
    jobTitle: 'Account Executive',
    department: 'Sales',
    countryCode: 'FR',
    baseSalary: '60000',
  });
  await insertEmployee({
    employeeCode: 'EMP-004',
    firstName: 'Dev',
    lastName: 'Patel',
    email: 'dev.patel@acme.com',
    jobTitle: 'Account Executive',
    department: 'Sales',
    baseSalary: '900000',
    exitType: 'resigned',
    noticeDate: '2026-10-01',
    lastWorkingDay: '2026-11-30',
  });
  await insertEmployee({
    employeeCode: 'EMP-005',
    firstName: 'Emma',
    lastName: 'Brown',
    email: 'emma.brown@acme.com',
    jobTitle: 'Analyst',
    department: 'Finance',
    countryCode: 'GB',
    baseSalary: '50000',
    exitType: 'resigned',
    noticeDate: '2026-08-31',
    lastWorkingDay: '2026-09-30',
  });
});
afterAll(() => testPool.end());

const list = (query = '') => request(app).get(`/api/employees${query}`).set('Cookie', cookie);

const codes = async (query: string) => {
  const res = await list(query);
  expect(res.status).toBe(200);
  return res.body.items.map((e: { employeeCode: string }) => e.employeeCode);
};

describe('GET /api/employees', () => {
  it('returns the first page sorted by name, in INR, with the rates date', async () => {
    const res = await list();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      total: 5,
      page: 1,
      pageSize: 25,
      currency: 'INR',
      ratesAsOf: '2026-10-01',
    });
    expect(res.body.items.map((e: { lastName: string }) => e.lastName)).toEqual([
      'Brown',
      'Carter',
      'Martin',
      'Patel',
      'Verma',
    ]);
    expect(res.body.items[4]).toEqual({
      id: expect.any(String),
      employeeCode: 'EMP-001',
      firstName: 'Asha',
      lastName: 'Verma',
      email: 'asha.verma@acme.com',
      jobTitle: 'Software Engineer',
      department: 'Engineering',
      countryCode: 'IN',
      currencyCode: 'INR',
      hireDate: '2024-04-01',
      baseSalary: '1800000.00',
      allowances: '200000.00',
      annualSalary: '2000000.00',
      convertedAnnualSalary: '2000000.00',
      status: 'active',
      lastWorkingDay: null,
    });
  });

  it('paginates with a stable total, including past the last page', async () => {
    const page2 = await list('?pageSize=2&page=2');
    const beyond = await list('?pageSize=2&page=4');

    expect(page2.body.items.map((e: { lastName: string }) => e.lastName)).toEqual([
      'Martin',
      'Patel',
    ]);
    expect(page2.body.total).toBe(5);
    expect(beyond.body).toMatchObject({ items: [], total: 5, page: 4 });
  });

  it('sorts by annual salary converted to one currency, not by raw local amounts', async () => {
    expect(await codes('?sort=annualSalary')).toEqual([
      'EMP-004',
      'EMP-001',
      'EMP-005',
      'EMP-003',
      'EMP-002',
    ]);
    expect(await codes('?sort=annualSalary&order=desc')).toEqual([
      'EMP-002',
      'EMP-003',
      'EMP-005',
      'EMP-001',
      'EMP-004',
    ]);
  });

  it('converts to the requested currency through INR, rounding at the end', async () => {
    const res = await list('?currency=USD&sort=employeeCode');

    expect(res.body.currency).toBe('USD');
    const byCode = Object.fromEntries(
      res.body.items.map((e: { employeeCode: string; convertedAnnualSalary: string }) => [
        e.employeeCode,
        e.convertedAnnualSalary,
      ]),
    );
    expect(byCode).toMatchObject({
      'EMP-001': '22535.21', // 2,000,000 ÷ 88.75
      'EMP-002': '160000.00', // already USD
      'EMP-003': '69769.01', // 60,000 × 103.20 ÷ 88.75
    });
  });

  it.each([
    ['?country=IN', ['EMP-004', 'EMP-001']],
    ['?department=Sales', ['EMP-003', 'EMP-004']],
    ['?jobTitle=Software%20Engineer', ['EMP-002', 'EMP-001']],
    ['?status=active', ['EMP-002', 'EMP-003', 'EMP-001']],
    ['?status=on_notice', ['EMP-004']],
    ['?status=exited', ['EMP-005']],
    ['?country=IN&status=active', ['EMP-001']],
  ])('filters with %s', async (query, expected) => {
    expect(await codes(query)).toEqual(expected);
  });

  it('derives status in SQL exactly as employeeStatus() does', async () => {
    const res = await list();

    for (const e of res.body.items) {
      expect(e.status).toBe(employeeStatus(e.lastWorkingDay, TODAY));
    }
  });

  it.each([
    ['last name, any case', 'VERMA', ['EMP-001']],
    ['full name', 'asha verma', ['EMP-001']],
    ['employee code', 'emp-003', ['EMP-003']],
    ['email', 'ben.carter@', ['EMP-002']],
    ['a LIKE wildcard taken literally', '%', []],
  ])('searches by %s', async (_case, q, expected) => {
    expect(await codes(`?q=${encodeURIComponent(q)}`)).toEqual(expected);
  });

  it.each([
    ['pageSize over 100', '?pageSize=101', 'pageSize'],
    ['page 0', '?page=0', 'page'],
    ['unknown sort field', '?sort=salary', 'sort'],
    ['unknown status', '?status=retired', 'status'],
    ['unknown currency', '?currency=XYZ', 'currency'],
  ])('returns 400 for %s', async (_case, query, path) => {
    const res = await list(query);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual([path]);
  });
});

describe('GET /api/employees/filter-options', () => {
  it('lists countries with currency, distinct departments and titles, and currencies', async () => {
    const res = await request(app).get('/api/employees/filter-options').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      countries: [
        { code: 'AU', name: 'Australia', currencyCode: 'AUD' },
        { code: 'CA', name: 'Canada', currencyCode: 'CAD' },
        { code: 'FR', name: 'France', currencyCode: 'EUR' },
        { code: 'DE', name: 'Germany', currencyCode: 'EUR' },
        { code: 'IN', name: 'India', currencyCode: 'INR' },
        { code: 'SG', name: 'Singapore', currencyCode: 'SGD' },
        { code: 'GB', name: 'United Kingdom', currencyCode: 'GBP' },
        { code: 'US', name: 'United States', currencyCode: 'USD' },
      ],
      departments: ['Engineering', 'Finance', 'Sales'],
      jobTitles: ['Account Executive', 'Analyst', 'Software Engineer'],
      currencies: ['AUD', 'CAD', 'EUR', 'GBP', 'INR', 'SGD', 'USD'],
    });
  });
});
