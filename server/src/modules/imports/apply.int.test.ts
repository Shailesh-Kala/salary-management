import { pino } from 'pino';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, fixedClock, type TestClock } from '../../../test/app.ts';
import { signIn } from '../../../test/auth.ts';
import { resetDb, testPool } from '../../../test/db.ts';
import { createUser } from '../auth/user-admin.ts';
import { insertEmployee } from '../../../test/factories.ts';
import { testJobHandlers } from '../../../test/handlers.ts';
import { createQueue } from '../../jobs/queue.ts';
import { createWorker } from '../../jobs/worker.ts';

const HEADER =
  'employee_code,first_name,last_name,email,job_title,department,country,hire_date,base_salary,allowances';
const FORM = {
  changeType: 'annual_review',
  effectiveDate: '2026-10-01',
  note: 'FY26 annual review',
};
const FILE = [
  HEADER,
  'EMP-1,Asha,Verma,e1@acme.com,Software Engineer,Engineering,IN,2024-04-01,2000000,0', //   1 update (raise)
  'NEW-1,Nina,Shah,n1@acme.com,Analyst,Finance,IN,2026-09-01,900000,0', //                   2 create
  'EMP-2,Ben,Carter,e2@acme.com,Software Engineer,Engineering,US,2024-04-01,150000,10000', // 3 relocation IN → US
  'NEW-2,Omar,Khan,n2@acme.com,Analyst,Finance,US,2026-09-15,80000,0', //                    4 create
  'EXAMPLE-1,Ex,Ample,x@acme.com,Analyst,Finance,IN,2024-01-01,1,0', //                      5 rejected in preview
].join('\n');

let app: ReturnType<typeof buildTestApp>;
let cookie: string;
let hrId: string;
let clock: TestClock;
let worker: ReturnType<typeof createWorker>;

beforeEach(async () => {
  await resetDb();
  app = buildTestApp();
  ({
    cookie,
    user: { id: hrId },
  } = await signIn(app));
  clock = fixedClock();
  worker = createWorker({
    queue: createQueue(testPool, clock),
    handlers: testJobHandlers({ clock }),
    logger: pino({ level: 'silent' }),
  });
  await insertEmployee({ employeeCode: 'EMP-1', email: 'e1@acme.com' });
  await insertEmployee({
    employeeCode: 'EMP-2',
    email: 'e2@acme.com',
    firstName: 'Ben',
    lastName: 'Carter',
  });
});
afterEach(() => testPool.query('DROP TRIGGER IF EXISTS fail_row_3 ON employee_changes'));
afterAll(() => testPool.end());

async function preview(content = FILE) {
  const req = request(app).post('/api/imports').set('Cookie', cookie);
  for (const [key, value] of Object.entries(FORM)) req.field(key, value);
  const { body } = await req.attach('file', Buffer.from(content), 'employees.csv');
  await worker.runOnce(); // validation
  return body.id as string;
}
const post = (id: string, action: 'confirm' | 'cancel', session = cookie) =>
  request(app).post(`/api/imports/${id}/${action}`).set('Cookie', session);
const getImport = async (id: string) =>
  (await request(app).get(`/api/imports/${id}`).set('Cookie', cookie)).body;
const snapshot = async () => ({
  employees: (await testPool.query('SELECT * FROM employees ORDER BY employee_code')).rows,
  changes: (await testPool.query('SELECT * FROM employee_changes ORDER BY id')).rows,
});
const history = async () =>
  (
    await testPool.query(
      `SELECT e.employee_code AS code, ch.change_type AS type, ch.effective_date AS date, ch.note,
              ch.source, ch.currency_code AS currency, ch.import_row_number AS "row", ch.changed_by AS "by"
         FROM employee_changes ch JOIN employees e ON e.id = ch.employee_id ORDER BY ch.import_row_number`,
    )
  ).rows;

/** Makes the history insert for import row 3 fail, either once (as a lost connection) or always. */
async function failRow3(mode: 'once-as-connection-loss' | 'always') {
  await testPool.query('CREATE SEQUENCE IF NOT EXISTS fail_row_3_seq');
  await testPool.query("SELECT setval('fail_row_3_seq', 1, false)");
  const condition = mode === 'always' ? 'true' : "nextval('fail_row_3_seq') = 1";
  const errcode = mode === 'always' ? 'P0001' : '08006';
  await testPool.query(`
    CREATE OR REPLACE FUNCTION fail_row_3() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.import_row_number = 3 AND ${condition} THEN
        RAISE EXCEPTION 'injected failure' USING ERRCODE = '${errcode}';
      END IF;
      RETURN NEW;
    END $$`);
  await testPool.query(
    'CREATE TRIGGER fail_row_3 BEFORE INSERT ON employee_changes FOR EACH ROW EXECUTE FUNCTION fail_row_3()',
  );
}

describe('cancel (T2)', () => {
  it('ends the import without writing any employee, history or audit data', async () => {
    const id = await preview();
    const before = await snapshot();

    const res = await post(id, 'cancel');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id,
      status: 'cancelled',
      finishedAt: '2026-10-12T09:00:00.000Z',
    });
    expect(await snapshot()).toEqual(before);
    expect((await post(id, 'confirm')).status).toBe(409);
  });

  it('can be done by any HR user, and also while still validating', async () => {
    await createUser(testPool, {
      email: 'other@acme.local',
      name: 'Other HR',
      password: 'another long password',
    });
    const other = await request(app)
      .post('/api/auth/login')
      .send({ email: 'other@acme.local', password: 'another long password' });
    const otherCookie = String(other.headers['set-cookie']?.[0]).split(';')[0]!;
    const req = request(app).post('/api/imports').set('Cookie', cookie);
    for (const [key, value] of Object.entries(FORM)) req.field(key, value);
    const { body } = await req.attach('file', Buffer.from(FILE), 'employees.csv');

    expect((await post(body.id, 'cancel', otherCookie)).body.status).toBe('cancelled');
    await worker.runOnce(); // the queued validation finds nothing to do
    expect((await getImport(body.id)).status).toBe('cancelled');
  });
});

describe('confirm and apply', () => {
  it('only confirms an import that is waiting for confirmation', async () => {
    const id = await preview();

    expect((await post(id, 'confirm')).status).toBe(202);
    const again = await post(id, 'confirm');

    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_STATE');
  });

  it('applies valid rows with history from the import (T7), hires on hire dates, relocations in the new currency (T14)', async () => {
    const id = await preview();
    await post(id, 'confirm');

    await worker.runOnce();

    expect(await getImport(id)).toMatchObject({
      status: 'completed',
      counts: { created: 2, updated: 2, unchanged: 0, rejected: 1 },
      finishedAt: '2026-10-12T09:00:00.000Z',
    });
    const emp1 = await testPool.query(
      "SELECT base_salary, version FROM employees WHERE employee_code = 'EMP-1'",
    );
    expect(emp1.rows).toEqual([{ base_salary: '2000000.00', version: 2 }]);
    expect(await history()).toEqual([
      {
        code: 'EMP-1',
        type: 'annual_review',
        date: '2026-10-01',
        note: 'FY26 annual review',
        source: 'import',
        currency: 'INR',
        row: 1,
        by: hrId,
      },
      {
        code: 'NEW-1',
        type: 'hire',
        date: '2026-09-01',
        note: 'FY26 annual review',
        source: 'import',
        currency: 'INR',
        row: 2,
        by: hrId,
      },
      {
        code: 'EMP-2',
        type: 'relocation',
        date: '2026-10-01',
        note: 'FY26 annual review',
        source: 'import',
        currency: 'USD',
        row: 3,
        by: hrId,
      },
      {
        code: 'NEW-2',
        type: 'hire',
        date: '2026-09-15',
        note: 'FY26 annual review',
        source: 'import',
        currency: 'USD',
        row: 4,
        by: hrId,
      },
    ]);
  });

  it('re-checks each row when applying, rejecting one that became invalid after the preview', async () => {
    const id = await preview();
    await insertEmployee({ employeeCode: 'EMP-9', email: 'n1@acme.com' }); // takes NEW-1's email
    await post(id, 'confirm');

    await worker.runOnce();

    const result = await getImport(id);
    expect(result.counts).toMatchObject({ created: 1, updated: 2, rejected: 2 });
    expect(result.rejected).toContainEqual({
      rowNumber: 2,
      employeeCode: 'NEW-1',
      errors: ['email: already used by EMP-9'],
    });
  });
});

describe('failures while applying', () => {
  it('after a lost connection, the retry applies every row exactly once (T8)', async () => {
    await failRow3('once-as-connection-loss');
    const id = await preview();
    await post(id, 'confirm');

    await worker.runOnce(); // rows 1–2 applied, row 3 hits the "connection loss"
    expect((await getImport(id)).status).toBe('applying');
    const afterFirst = await history();
    expect(afterFirst.map((h) => h.row)).toEqual([1, 2]);

    clock.advance(10_000);
    await worker.runOnce(); // retry: skips rows 1–2, applies 3–4

    expect((await getImport(id)).status).toBe('completed');
    const final = await history();
    expect(final.map((h) => h.row)).toEqual([1, 2, 3, 4]);
    expect(final.slice(0, 2)).toEqual(afterFirst);
    const emp1 = await testPool.query(
      "SELECT version FROM employees WHERE employee_code = 'EMP-1'",
    );
    expect(emp1.rows[0].version).toBe(2); // updated once, not twice
  });

  it('an unexpected error rejects just that row and the rest of the import completes (T15)', async () => {
    await failRow3('always');
    const id = await preview();
    await post(id, 'confirm');

    await worker.runOnce();

    const result = await getImport(id);
    expect(result).toMatchObject({
      status: 'completed',
      counts: { created: 2, updated: 1, rejected: 2 },
    });
    expect(result.rejected).toContainEqual({
      rowNumber: 3,
      employeeCode: 'EMP-2',
      errors: [expect.stringMatching(/^Unexpected error: row not imported \(ref \d+\/3\)$/)],
    });
    const emp2 = await testPool.query(
      "SELECT country_code FROM employees WHERE employee_code = 'EMP-2'",
    );
    expect(emp2.rows).toEqual([{ country_code: 'IN' }]); // its transaction was rolled back
    const job = await testPool.query(
      "SELECT status, attempts FROM jobs WHERE type = 'import_apply'",
    );
    expect(job.rows).toEqual([{ status: 'completed', attempts: 1 }]); // not retried
  });
});
