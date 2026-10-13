import { parse } from 'csv-parse/sync';
import { pino } from 'pino';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, fixedClock } from '../../../test/app.ts';
import { signIn } from '../../../test/auth.ts';
import { resetDb, testPool } from '../../../test/db.ts';
import { insertEmployee } from '../../../test/factories.ts';
import { testJobHandlers } from '../../../test/handlers.ts';
import { createQueue } from '../../jobs/queue.ts';
import { createWorker } from '../../jobs/worker.ts';

const HEADER = [
  'employee_code',
  'first_name',
  'last_name',
  'email',
  'job_title',
  'department',
  'country',
  'hire_date',
  'base_salary',
  'allowances',
];
const FORM = {
  changeType: 'annual_review',
  effectiveDate: '2026-10-01',
  note: 'FY26 annual review',
};

// Matches insertEmployee's defaults: Software Engineer, Engineering, IN, hired 2024-04-01, 1,800,000 + 0.
const row = (code: string, n: number, overrides: Partial<Record<string, string>> = {}) => {
  const values: Record<string, string> = {
    employee_code: code,
    first_name: 'Asha',
    last_name: 'Verma',
    email: `e${n}@acme.com`,
    job_title: 'Software Engineer',
    department: 'Engineering',
    country: 'IN',
    hire_date: '2024-04-01',
    base_salary: '1800000',
    allowances: '0',
    ...overrides,
  };
  return HEADER.map((h) => values[h]).join(',');
};

// Fourteen rows, each with a known outcome (see expectations below).
const FILE = [
  HEADER.join(','),
  row('EMP-1', 1, { base_salary: '2000000' }), //                                      1 update
  row('EMP-2', 2, { country: 'US', base_salary: '150000', allowances: '10000' }), //    2 unchanged
  row('NEW-1', 11, { hire_date: '2026-09-01' }), //                                     3 create
  row('NEW-2', 12, { hire_date: '2026-09-15' }), //                                     4 create
  row('EXAMPLE-1', 13), //                                                             5 rejected: example row
  row('EMP-1', 1, { base_salary: '2100000' }), //                                      6 rejected: duplicate code
  row('NEW-3', 2), //                                                                  7 rejected: email of EMP-2
  row('NEW-4', 14, { base_salary: 'abc' }), //                                         8 rejected: bad amount
  row('EMP-3', 3, { base_salary: '2000000' }), //                                      9 rejected: has left
  row('EMP-4', 4, { base_salary: '2000000' }), //                                     10 rejected: before latest change
  row('EMP-5', 5, { last_name: 'Sharma' }), //                                        11 update (no history)
  row('EMP-6', 6, { country: 'US' }), //                                              12 rejected: country without salary
  row('EMP-7', 7, { hire_date: '2024-03-01' }), //                                    13 rejected: hire date not correction
  'NEW-5,Short,Row', //                                                               14 rejected: too few values
].join('\n');

let app: ReturnType<typeof buildTestApp>;
let cookie: string;
let worker: ReturnType<typeof createWorker>;

beforeEach(async () => {
  await resetDb();
  app = buildTestApp(); // now = 2026-10-12T09:00:00Z
  const session = await signIn(app);
  cookie = session.cookie;
  const clock = fixedClock();
  worker = createWorker({
    queue: createQueue(testPool, clock),
    handlers: testJobHandlers({ clock }),
    logger: pino({ level: 'silent' }),
  });

  await insertEmployee({ employeeCode: 'EMP-1', email: 'e1@acme.com' });
  await insertEmployee({
    employeeCode: 'EMP-2',
    email: 'e2@acme.com',
    countryCode: 'US',
    baseSalary: '150000',
    allowances: '10000',
  });
  await insertEmployee({
    employeeCode: 'EMP-3',
    email: 'e3@acme.com',
    exitType: 'resigned',
    noticeDate: '2026-08-01',
    lastWorkingDay: '2026-09-30',
  });
  const emp4 = await insertEmployee({ employeeCode: 'EMP-4', email: 'e4@acme.com' });
  await insertEmployee({ employeeCode: 'EMP-5', email: 'e5@acme.com' });
  await insertEmployee({ employeeCode: 'EMP-6', email: 'e6@acme.com' });
  await insertEmployee({ employeeCode: 'EMP-7', email: 'e7@acme.com' });
  await testPool.query(
    `INSERT INTO employee_changes (employee_id, change_type, effective_date, note, source, changes,
       base_salary, allowances, currency_code, country_code, job_title, department, changed_by, changed_at)
     VALUES ($1, 'market_adjustment', '2026-10-05', 'Recent adjustment', 'ui', '{}', 1800000, 0, 'INR',
       'IN', 'Software Engineer', 'Engineering', $2, now())`,
    [emp4, session.user.id],
  );
});
afterAll(() => testPool.end());

const upload = (content: string) => {
  const req = request(app).post('/api/imports').set('Cookie', cookie);
  for (const [key, value] of Object.entries(FORM)) req.field(key, value);
  return req.attach('file', Buffer.from(content), 'employees.csv');
};
const getImport = (id: string) => request(app).get(`/api/imports/${id}`).set('Cookie', cookie);

async function uploadAndValidate(content = FILE) {
  const { body } = await upload(content);
  await worker.runOnce();
  return body.id as string;
}

describe('import validation and preview (T1)', () => {
  it('classifies every row and shows exact preview counts, writing nothing to employees', async () => {
    const id = await uploadAndValidate();

    const res = await getImport(id);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id,
      status: 'awaiting_confirmation',
      fileName: 'employees.csv',
      rowCount: 14,
      counts: { total: 14, valid: 5, toCreate: 2, toUpdate: 2, unchanged: 1, rejected: 9 },
      previewExpiresAt: '2026-10-13T09:00:00.000Z',
      uploadedBy: { name: 'HR Manager' },
    });
    expect(res.body.rejected.map((r: { rowNumber: number }) => r.rowNumber)).toEqual([
      5, 6, 7, 8, 9, 10, 12, 13, 14,
    ]);
    expect(res.body.rejected[1]).toEqual({
      rowNumber: 6,
      employeeCode: 'EMP-1',
      errors: ['employee_code: also on row 1 of this file'],
    });
    const employees = await testPool.query(
      "SELECT base_salary FROM employees WHERE employee_code = 'EMP-1'",
    );
    expect(employees.rows).toEqual([{ base_salary: '1800000.00' }]);
    expect((await testPool.query('SELECT count(*)::int AS n FROM employees')).rows[0].n).toBe(7);
  });

  it('schedules the 24-hour preview expiry', async () => {
    const id = await uploadAndValidate();

    const { rows } = await testPool.query(
      'SELECT payload, run_after AS "runAfter" FROM jobs WHERE type = \'import_expire\'',
    );

    expect(rows).toEqual([
      { payload: { importId: id }, runAfter: new Date('2026-10-13T09:00:00Z') },
    ]);
  });

  it('does nothing when validation runs again after it has finished (retry-safe)', async () => {
    const id = await uploadAndValidate();
    const handler = testJobHandlers({ clock: fixedClock() }).import_validate!;

    await handler({
      id: 'retry',
      type: 'import_validate',
      payload: { importId: id },
      attempts: 2,
      maxAttempts: 3,
    });

    expect((await testPool.query('SELECT count(*)::int AS n FROM import_rows')).rows[0].n).toBe(14);
    expect(
      (await testPool.query("SELECT count(*)::int AS n FROM jobs WHERE type = 'import_expire'"))
        .rows[0].n,
    ).toBe(1);
  });

  it('returns 404 for an unknown import', async () => {
    expect((await getImport('00000000-0000-0000-0000-000000000000')).status).toBe(404);
  });
});

describe('rejected-rows CSV (T3)', () => {
  it('has the original header plus error, one line per rejected row with its original values', async () => {
    const id = await uploadAndValidate();

    const res = await request(app).get(`/api/imports/${id}/rejected.csv`).set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="employees-rejected.csv"',
    );
    const [header, ...lines] = parse(res.text, {
      bom: true,
      relax_column_count: true,
    }) as string[][];
    expect(header).toEqual([...HEADER, 'error']);
    expect(lines).toHaveLength(9);
    const badAmount = lines.find((l) => l[0] === 'NEW-4')!;
    expect(badAmount.slice(0, 10)).toEqual(row('NEW-4', 14, { base_salary: 'abc' }).split(','));
    expect(badAmount[10]).toBe('base_salary: Must be an amount like 95000 or 95000.50');
  });

  it('can be fixed and uploaded again as it is', async () => {
    const id = await uploadAndValidate();
    const csv = (await request(app).get(`/api/imports/${id}/rejected.csv`).set('Cookie', cookie))
      .text;
    await testPool.query("UPDATE imports SET status = 'cancelled'");
    const fixed = csv
      .split('\n')
      .filter((line, i) => i === 0 || line.startsWith('NEW-4,'))
      .map((line) => line.replace(',abc,', ',90000,'))
      .join('\n');

    const again = await upload(fixed);
    await worker.runOnce();

    expect(again.status).toBe(202);
    expect((await getImport(again.body.id)).body.counts).toMatchObject({
      toCreate: 1,
      rejected: 0,
    });
  });
});
