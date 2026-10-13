import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../../../test/app.ts';
import { signIn } from '../../../test/auth.ts';
import { resetDb, testPool } from '../../../test/db.ts';
import { type EmployeeFixture, insertEmployee } from '../../../test/factories.ts';

// Today is 2026-10-12; the default Q6 range is the last 90 days (2026-07-14 → 2026-10-12).
let app: ReturnType<typeof buildTestApp>;
let cookie: string;
let hrId: string;

afterAll(() => testPool.end());

const insights = (path: string) => request(app).get(`/api/insights${path}`).set('Cookie', cookie);

async function setUp() {
  await resetDb();
  app = buildTestApp();
  const session = await signIn(app);
  cookie = session.cookie;
  hrId = session.user.id;
}

/** Inserts a history entry; the snapshot is the state after it. */
async function addChange(
  employeeId: string,
  changeType: string,
  effectiveDate: string,
  s: Pick<
    EmployeeFixture,
    'baseSalary' | 'allowances' | 'jobTitle' | 'department' | 'countryCode'
  > & {
    currencyCode: string;
  },
) {
  await testPool.query(
    `INSERT INTO employee_changes (employee_id, change_type, effective_date, note, source, changes,
       base_salary, allowances, currency_code, country_code, job_title, department, changed_by, changed_at)
     VALUES ($1, $2, $3, 'Fixture change', 'ui', '{}', $4, $5, $6, $7, $8, $9, $10, $3::date)`,
    [
      employeeId,
      changeType,
      effectiveDate,
      s.baseSalary,
      s.allowances,
      s.currencyCode,
      s.countryCode,
      s.jobTitle,
      s.department,
      hrId,
    ],
  );
}

describe('GET /api/insights/recent-changes (Q6)', () => {
  beforeAll(async () => {
    await setUp();
    const se = {
      jobTitle: 'Software Engineer',
      department: 'Engineering',
      countryCode: 'IN',
      currencyCode: 'INR',
    };

    // EMP-1: promoted 2026-09-01, annual 2,000,000 → 2,400,000 (+20%)
    const e1 = await insertEmployee({
      employeeCode: 'EMP-1',
      email: 'e1@acme.com',
      jobTitle: 'Senior Software Engineer',
      baseSalary: '2200000',
      allowances: '200000',
    });
    await addChange(e1, 'hire', '2024-04-01', {
      ...se,
      baseSalary: '1800000',
      allowances: '200000',
    });
    await addChange(e1, 'promotion', '2026-09-01', {
      ...se,
      jobTitle: 'Senior Software Engineer',
      baseSalary: '2200000',
      allowances: '200000',
    });

    // EMP-2: annual review 2026-04-01 (outside the default range), 1,000,000 → 1,050,000 (+5%)
    const ae = {
      jobTitle: 'Account Executive',
      department: 'Sales',
      countryCode: 'IN',
      currencyCode: 'INR',
      allowances: '0',
    };
    const e2 = await insertEmployee({
      employeeCode: 'EMP-2',
      email: 'e2@acme.com',
      ...ae,
      baseSalary: '1050000',
    });
    await addChange(e2, 'hire', '2023-01-01', { ...ae, baseSalary: '1000000' });
    await addChange(e2, 'annual_review', '2026-04-01', { ...ae, baseSalary: '1050000' });

    // EMP-3: relocated IN → US on 2026-08-15 (no % across currencies)
    const e3 = await insertEmployee({
      employeeCode: 'EMP-3',
      email: 'e3@acme.com',
      countryCode: 'US',
      baseSalary: '150000',
      allowances: '10000',
    });
    await addChange(e3, 'hire', '2022-06-01', { ...se, baseSalary: '1500000', allowances: '0' });
    await addChange(e3, 'relocation', '2026-08-15', {
      ...se,
      countryCode: 'US',
      currencyCode: 'USD',
      baseSalary: '150000',
      allowances: '10000',
    });

    // EMP-4: hired inside the range — hires are not pay changes, so not listed
    const e4 = await insertEmployee({
      employeeCode: 'EMP-4',
      email: 'e4@acme.com',
      hireDate: '2026-09-15',
    });
    await addChange(e4, 'hire', '2026-09-15', { ...se, baseSalary: '1800000', allowances: '0' });
  });

  it('lists pay and title changes from the last 90 days, newest first, with before → after', async () => {
    const res = await insights('/recent-changes');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ from: '2026-07-14', to: '2026-10-12', total: 2, page: 1 });
    expect(res.body.items).toEqual([
      {
        id: expect.any(String),
        employeeId: expect.any(String),
        employeeCode: 'EMP-1',
        firstName: 'Asha',
        lastName: 'Verma',
        changeType: 'promotion',
        effectiveDate: '2026-09-01',
        note: 'Fixture change',
        oldJobTitle: 'Software Engineer',
        newJobTitle: 'Senior Software Engineer',
        oldCountryCode: 'IN',
        newCountryCode: 'IN',
        oldAnnualSalary: '2000000.00',
        newAnnualSalary: '2400000.00',
        oldCurrencyCode: 'INR',
        newCurrencyCode: 'INR',
        salaryChangePercent: '20.00',
        changedBy: 'HR Manager',
      },
      expect.objectContaining({
        employeeCode: 'EMP-3',
        changeType: 'relocation',
        oldCountryCode: 'IN',
        newCountryCode: 'US',
        oldAnnualSalary: '1500000.00',
        newAnnualSalary: '160000.00',
        oldCurrencyCode: 'INR',
        newCurrencyCode: 'USD',
        salaryChangePercent: null,
      }),
    ]);
  });

  it('widens the range and filters by change type', async () => {
    const wide = await insights('/recent-changes?from=2026-01-01');
    const reviews = await insights('/recent-changes?from=2026-01-01&changeType=annual_review');

    expect(wide.body.total).toBe(3);
    expect(reviews.body.items).toEqual([
      expect.objectContaining({
        employeeCode: 'EMP-2',
        salaryChangePercent: '5.00',
        oldJobTitle: 'Account Executive',
      }),
    ]);
  });

  it.each([
    ['a reversed range', '?from=2026-10-01&to=2026-09-01', 'from'],
    ['hire as a change type', '?changeType=hire', 'changeType'],
  ])('returns 400 for %s', async (_case, query, path) => {
    const res = await insights(`/recent-changes${query}`);

    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual([path]);
  });
});

describe('GET /api/insights/leavers (Q7)', () => {
  beforeAll(async () => {
    await setUp();
    const leaving = (n: number, lastWorkingDay: string, overrides: Partial<EmployeeFixture>) =>
      insertEmployee({
        employeeCode: `L-${n}`,
        email: `l${n}@acme.com`,
        firstName: `Leaver${n}`,
        exitType: 'resigned',
        noticeDate: '2026-10-01',
        lastWorkingDay,
        ...overrides,
      });
    await leaving(1, '2026-11-30', { baseSalary: '1200000' }); // IN Engineering
    await leaving(2, '2026-10-31', { countryCode: 'US', baseSalary: '100000' }); // = 8,875,000 INR
    await leaving(3, '2026-12-15', { department: 'Sales', baseSalary: '600000' });
    await leaving(4, '2026-09-30', { baseSalary: '5000000', noticeDate: '2026-08-01' }); // already exited
    await insertEmployee({ employeeCode: 'A-1', email: 'a1@acme.com' }); // active, not leaving
  });

  it('totals pay leaving by department and country and lists leavers by last working day', async () => {
    const res = await insights('/leavers');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      currency: 'INR',
      ratesAsOf: '2026-10-01',
      headcount: 3,
      totalAnnualSalary: '10675000.00',
      byDepartment: [
        { department: 'Engineering', headcount: 2, totalAnnualSalary: '10075000.00' },
        { department: 'Sales', headcount: 1, totalAnnualSalary: '600000.00' },
      ],
      byCountry: [
        {
          countryCode: 'US',
          countryName: 'United States',
          headcount: 1,
          totalAnnualSalary: '8875000.00',
        },
        { countryCode: 'IN', countryName: 'India', headcount: 2, totalAnnualSalary: '1800000.00' },
      ],
    });
    expect(res.body.employees.map((e: { employeeCode: string }) => e.employeeCode)).toEqual([
      'L-2',
      'L-1',
      'L-3',
    ]);
    expect(res.body.employees[0]).toEqual({
      id: expect.any(String),
      employeeCode: 'L-2',
      firstName: 'Leaver2',
      lastName: 'Verma',
      jobTitle: 'Software Engineer',
      department: 'Engineering',
      countryCode: 'US',
      exitType: 'resigned',
      lastWorkingDay: '2026-10-31',
      convertedAnnualSalary: '8875000.00',
    });
  });

  it('converts to the reporting currency and applies filters', async () => {
    const usd = await insights('/leavers?currency=USD');
    const sales = await insights('/leavers?department=Sales');

    expect(usd.body.totalAnnualSalary).toBe('120281.69'); // 10,675,000 ÷ 88.75
    expect(sales.body).toMatchObject({ headcount: 1, totalAnnualSalary: '600000.00' });
  });
});
