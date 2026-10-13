import { pino } from 'pino';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, fixedClock, type TestClock } from '../../../test/app.ts';
import { signIn } from '../../../test/auth.ts';
import { resetDb, testPool } from '../../../test/db.ts';
import { insertEmployee } from '../../../test/factories.ts';
import { jobHandlers } from '../../jobs/handlers.ts';
import { createQueue } from '../../jobs/queue.ts';
import { createWorker } from '../../jobs/worker.ts';

const HOUR = 60 * 60 * 1000;
const FORM = {
  changeType: 'annual_review',
  effectiveDate: '2026-10-01',
  note: 'FY26 annual review',
};
const FILE = [
  'employee_code,first_name,last_name,email,job_title,department,country,hire_date,base_salary,allowances',
  'EMP-1,Asha,Verma,e1@acme.com,Software Engineer,Engineering,IN,2024-04-01,2000000,0',
  'NEW-1,Nina,Shah,n1@acme.com,Analyst,Finance,IN,2026-09-01,900000,0',
  'EXAMPLE-1,Ex,Ample,x@acme.com,Analyst,Finance,IN,2024-01-01,1,0',
].join('\n');

let app: ReturnType<typeof buildTestApp>;
let cookie: string;
let clock: TestClock;
let worker: ReturnType<typeof createWorker>;

beforeEach(async () => {
  await resetDb();
  clock = fixedClock(); // 2026-10-12T09:00:00Z, shared by the API and the worker
  app = buildTestApp({ clock });
  ({ cookie } = await signIn(app));
  worker = createWorker({
    queue: createQueue(testPool, clock),
    handlers: jobHandlers({ db: testPool, clock }),
    logger: pino({ level: 'silent' }),
  });
  await insertEmployee({ employeeCode: 'EMP-1', email: 'e1@acme.com' });
});
afterEach(() =>
  testPool.query('DROP TRIGGER IF EXISTS always_lose_connection ON employee_changes'),
);
afterAll(() => testPool.end());

async function upload() {
  const req = request(app).post('/api/imports').set('Cookie', cookie);
  for (const [key, value] of Object.entries(FORM)) req.field(key, value);
  return req.attach('file', Buffer.from(FILE), 'employees.csv');
}
async function preview() {
  const { body } = await upload();
  await worker.runOnce();
  return body.id as string;
}
const confirm = (id: string) =>
  request(app).post(`/api/imports/${id}/confirm`).set('Cookie', cookie);
const getImport = async (id: string) =>
  (await request(app).get(`/api/imports/${id}`).set('Cookie', cookie)).body;
const stored = async (id: string) => ({
  file: (await testPool.query('SELECT file IS NOT NULL AS kept FROM imports WHERE id = $1', [id]))
    .rows[0].kept,
  rows: (
    await testPool.query(
      `SELECT row_number AS "rowNumber", employee_code AS "employeeCode", raw IS NOT NULL AS "rawKept",
              coalesce(outcome, preview_outcome) AS outcome, errors
         FROM import_rows WHERE import_id = $1 ORDER BY row_number`,
      [id],
    )
  ).rows,
});
const employeeCount = async () =>
  (await testPool.query('SELECT count(*)::int AS n FROM employees')).rows[0].n;

describe('preview expiry (T12)', () => {
  it('refuses to confirm once 24 hours have passed, even before the expiry job runs', async () => {
    const id = await preview();
    clock.advance(24 * HOUR);

    const res = await confirm(id);

    expect(res.status).toBe(410);
    expect(res.body.error).toMatchObject({
      code: 'GONE',
      message:
        'This preview expired at 2026-10-13T09:00:00.000Z. Upload the file again to import it.',
    });
    expect(await employeeCount()).toBe(1);
  });

  it('expires the preview when its job runs, then lets a new upload in; running it again changes nothing', async () => {
    const id = await preview();
    clock.advance(24 * HOUR - 1);
    await worker.runOnce(); // not due yet
    expect((await getImport(id)).status).toBe('awaiting_confirmation');

    clock.advance(1);
    await worker.runOnce();

    expect(await getImport(id)).toMatchObject({
      status: 'expired',
      finishedAt: '2026-10-13T09:00:00.000Z',
    });
    expect((await confirm(id)).status).toBe(410);
    expect((await upload()).status).toBe(202);

    const handler = jobHandlers({ db: testPool, clock }).import_expire!;
    await handler({
      id: 'again',
      type: 'import_expire',
      payload: { importId: id },
      attempts: 1,
      maxAttempts: 3,
    });
    expect((await getImport(id)).status).toBe('expired');
  });

  it('never blocks a new upload with an overdue preview, even if its job has not run', async () => {
    const id = await preview();
    clock.advance(25 * HOUR);

    expect((await upload()).status).toBe(202);
    expect((await getImport(id)).status).toBe('expired');
  });
});

describe('import data cleared when an import ends (T13)', () => {
  const expectCleared = async (id: string, outcomes: string[]) => {
    const { file, rows } = await stored(id);
    expect(file).toBe(false);
    expect(rows.map((r) => r.rawKept)).toEqual(rows.map(() => false));
    expect(rows.map((r) => [r.rowNumber, r.employeeCode, r.outcome])).toEqual(
      outcomes.map((outcome, i) => [i + 1, ['EMP-1', 'NEW-1', 'EXAMPLE-1'][i], outcome]),
    );
    expect(rows[2]!.errors).toEqual(['Example row: replace it with a real employee or delete it']);
  };

  it('keeps the file and raw rows while the preview is open', async () => {
    const id = await preview();

    const { file, rows } = await stored(id);
    expect(file).toBe(true);
    expect(rows.every((r) => r.rawKept)).toBe(true);
  });

  it('clears them when the import completes', async () => {
    const id = await preview();
    await confirm(id);
    await worker.runOnce();

    await expectCleared(id, ['updated', 'created', 'rejected']);
  });

  it('clears them when the import is cancelled', async () => {
    const id = await preview();
    await request(app).post(`/api/imports/${id}/cancel`).set('Cookie', cookie);

    await expectCleared(id, ['update', 'create', 'rejected']);
  });

  it('clears them when the preview expires', async () => {
    const id = await preview();
    clock.advance(24 * HOUR);
    await worker.runOnce();

    await expectCleared(id, ['update', 'create', 'rejected']);
  });

  it('marks the import failed and clears it when applying keeps failing', async () => {
    await testPool.query(`
      CREATE OR REPLACE FUNCTION always_lose_connection() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected' USING ERRCODE = '08006'; END $$`);
    await testPool.query(
      'CREATE TRIGGER always_lose_connection BEFORE INSERT ON employee_changes FOR EACH ROW EXECUTE FUNCTION always_lose_connection()',
    );
    const id = await preview();
    await confirm(id);

    for (const wait of [0, 10_000, 20_000]) {
      clock.advance(wait);
      await worker.runOnce();
    }

    expect(await getImport(id)).toMatchObject({ status: 'failed', error: 'injected' });
    expect((await stored(id)).file).toBe(false);
    expect((await stored(id)).rows.every((r) => !r.rawKept)).toBe(true);
    expect((await upload()).status).toBe(202); // a failed import no longer blocks uploads
  });

  it('no longer offers the rejected-rows file once the import has ended', async () => {
    const id = await preview();
    await request(app).post(`/api/imports/${id}/cancel`).set('Cookie', cookie);

    const res = await request(app).get(`/api/imports/${id}/rejected.csv`).set('Cookie', cookie);

    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('GONE');
  });
});
