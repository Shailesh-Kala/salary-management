import { pino } from 'pino';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { buildTestApp, fixedClock } from '../../../test/app.ts';
import { signIn } from '../../../test/auth.ts';
import { resetDb, testPool } from '../../../test/db.ts';
import { insertEmployee } from '../../../test/factories.ts';
import { testJobHandlers } from '../../../test/handlers.ts';
import { createQueue } from '../../jobs/queue.ts';
import { createWorker } from '../../jobs/worker.ts';

// Makes the row rules fail like a bug would, for one employee code, while `state.poisoned` is on.
const state = vi.hoisted(() => ({ poisoned: false }));
vi.mock('./validate-rows.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./validate-rows.ts')>();
  type Employees = import('./validate-rows.ts').RowContext['employeesByCode'];
  class FailsForBoom extends Map<string, unknown> {
    override get(code: string) {
      if (code === 'EMP-BOOM') throw new Error('injected rule failure');
      return super.get(code);
    }
  }
  return {
    ...original,
    validateRows: (
      ...[header, rows, ctx, onUnexpected]: Parameters<typeof original.validateRows>
    ) =>
      original.validateRows(
        header,
        rows,
        state.poisoned
          ? { ...ctx, employeesByCode: new FailsForBoom(ctx.employeesByCode) as Employees }
          : ctx,
        onUnexpected,
      ),
  };
});

const FORM = {
  changeType: 'annual_review',
  effectiveDate: '2026-10-01',
  note: 'FY26 annual review',
};
const FILE = [
  'employee_code,first_name,last_name,email,job_title,department,country,hire_date,base_salary,allowances',
  'EMP-1,Asha,Verma,e1@acme.com,Software Engineer,Engineering,IN,2024-04-01,2000000,0',
  'EMP-BOOM,Bo,Om,boom@acme.com,Analyst,Finance,IN,2026-09-01,777777,0',
  'NEW-1,Nina,Shah,n1@acme.com,Analyst,Finance,IN,2026-09-01,900000,0',
].join('\n');

let app: ReturnType<typeof buildTestApp>;
let cookie: string;
let worker: ReturnType<typeof createWorker>;
let logLines: string[];

beforeEach(async () => {
  await resetDb();
  state.poisoned = false;
  logLines = [];
  const clock = fixedClock();
  app = buildTestApp({ clock });
  ({ cookie } = await signIn(app));
  worker = createWorker({
    queue: createQueue(testPool, clock),
    handlers: testJobHandlers({
      clock,
      logger: pino({ level: 'error' }, { write: (line: string) => void logLines.push(line) }),
    }),
    logger: pino({ level: 'silent' }),
  });
  await insertEmployee({ employeeCode: 'EMP-1', email: 'e1@acme.com' });
});
afterAll(() => testPool.end());

async function upload() {
  const req = request(app).post('/api/imports').set('Cookie', cookie);
  for (const [key, value] of Object.entries(FORM)) req.field(key, value);
  return (await req.attach('file', Buffer.from(FILE), 'employees.csv')).body.id as string;
}
const getImport = async (id: string) =>
  (await request(app).get(`/api/imports/${id}`).set('Cookie', cookie)).body;
const unexpectedLogs = () =>
  logLines
    .map((line) => JSON.parse(line))
    .filter((l) => l.msg === 'import row failed unexpectedly');
const boomRow = {
  rowNumber: 2,
  employeeCode: 'EMP-BOOM',
  errors: [expect.stringMatching(/^Unexpected error: row not imported \(ref \d+\/2\)$/)],
};

describe('an unexpected error in the row rules', () => {
  it('rejects only that row in the preview, with a reference that matches a log line', async () => {
    state.poisoned = true;
    const id = await upload();

    await worker.runOnce();

    const preview = await getImport(id);
    expect(preview).toMatchObject({
      status: 'awaiting_confirmation',
      counts: { valid: 2, rejected: 1 },
    });
    expect(preview.rejected).toEqual([boomRow]);
    const [log] = unexpectedLogs();
    expect(unexpectedLogs()).toHaveLength(1);
    expect(preview.rejected[0].errors[0]).toContain(`ref ${log.jobId}/2`);
    expect(log).toMatchObject({ rowNumber: 2, error: 'injected rule failure' });
    // No pay or personal data goes to the log.
    expect(logLines.join('')).not.toMatch(/777777|boom@acme\.com|Bo,Om/);
    const job = await testPool.query(
      "SELECT status, attempts FROM jobs WHERE type = 'import_validate'",
    );
    expect(job.rows).toEqual([{ status: 'completed', attempts: 1 }]); // not retried
  });

  it('rejects only that row while applying, and logs the same reference', async () => {
    const id = await upload();
    await worker.runOnce(); // a clean preview: all three rows are valid
    state.poisoned = true;
    await request(app).post(`/api/imports/${id}/confirm`).set('Cookie', cookie);

    await worker.runOnce();

    const result = await getImport(id);
    expect(result).toMatchObject({
      status: 'completed',
      counts: { created: 1, updated: 1, rejected: 1 },
    });
    expect(result.rejected).toEqual([boomRow]);
    const [log] = unexpectedLogs();
    expect(unexpectedLogs()).toHaveLength(1);
    expect(result.rejected[0].errors[0]).toContain(`ref ${log.jobId}/2`);
    expect(log).toMatchObject({ rowNumber: 2, error: 'injected rule failure' });
    const created = await testPool.query(
      "SELECT employee_code FROM employees WHERE employee_code IN ('EMP-BOOM', 'NEW-1') ORDER BY 1",
    );
    expect(created.rows).toEqual([{ employee_code: 'NEW-1' }]);
  });
});
