import { pino } from 'pino';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, fixedClock, type TestClock } from '../../../test/app.ts';
import { signIn } from '../../../test/auth.ts';
import { resetDb, testPool } from '../../../test/db.ts';
import { insertEmployee } from '../../../test/factories.ts';
import { testJobHandlers } from '../../../test/handlers.ts';
import { fakeMailer } from '../../../test/mailer.ts';
import { createQueue } from '../../jobs/queue.ts';
import { createWorker } from '../../jobs/worker.ts';

const HR_EMAIL = 'hr@acme.local';

let app: ReturnType<typeof buildTestApp>;
let cookie: string;
let clock: TestClock;
let mailer: ReturnType<typeof fakeMailer>;
let queue: ReturnType<typeof createQueue>;
let worker: ReturnType<typeof createWorker>;

const workerWith = (q = queue) =>
  createWorker({
    queue: q,
    handlers: testJobHandlers({ clock, mailer }),
    logger: pino({ level: 'silent' }),
  });

beforeEach(async () => {
  await resetDb();
  clock = fixedClock(); // 2026-10-12T09:00:00Z
  mailer = fakeMailer();
  app = buildTestApp({ clock });
  ({ cookie } = await signIn(app, HR_EMAIL));
  queue = createQueue(testPool, clock);
  worker = workerWith();
  await insertEmployee({ employeeCode: 'EMP-1', email: 'e1@acme.com', baseSalary: '1234567' });
  await insertEmployee({
    employeeCode: 'EMP-2',
    email: 'e2@acme.com',
    countryCode: 'US',
    baseSalary: '98765',
  });
});
afterAll(() => testPool.end());

const requestEmail = (body: object = {}) =>
  request(app).post('/api/exports/employees/email').set('Cookie', cookie).send(body);
const exportRow = async (id: string) =>
  (
    await testPool.query(
      `SELECT status, format, delivery, row_count AS "rowCount", filters, expires_at AS "expiresAt",
              email_sent_at AS "emailSentAt", length(file) AS "fileBytes", file_name AS "fileName",
              error
         FROM exports WHERE id = $1`,
      [id],
    )
  ).rows[0];
const jobs = async (type: string) =>
  (
    await testPool.query(
      `SELECT status, run_after AS "runAfter" FROM jobs WHERE type = $1 ORDER BY id`,
      [type],
    )
  ).rows;

describe('POST /api/exports/employees/email', () => {
  it('queues the export (202) and audits it as an emailed PDF with its filters', async () => {
    const res = await requestEmail({ country: 'IN', currency: 'USD' });

    expect(res.status).toBe(202);
    expect(await exportRow(res.body.exportId)).toMatchObject({
      status: 'queued',
      format: 'pdf',
      delivery: 'email',
      rowCount: 1,
      filters: expect.objectContaining({ country: 'IN', currency: 'USD' }),
    });
    expect(await jobs('export_pdf')).toHaveLength(1);
    expect(mailer.sent).toEqual([]);
  });

  it('rejects invalid filters and requires a session', async () => {
    expect((await requestEmail({ country: 'India' })).status).toBe(400);
    expect((await request(app).post('/api/exports/employees/email').send({})).status).toBe(401);
  });
});

describe('the export_pdf job (T11 server part)', () => {
  it('builds the PDF, emails the requester a link to the app page, and schedules cleanup', async () => {
    const { body } = await requestEmail();

    await worker.runOnce();

    expect(await exportRow(body.exportId)).toMatchObject({
      status: 'ready',
      fileName: 'employees-2026-10-12.pdf',
      expiresAt: new Date('2026-10-13T09:00:00.000Z'),
      emailSentAt: new Date('2026-10-12T09:00:00.000Z'),
    });
    expect((await exportRow(body.exportId)).fileBytes).toBeGreaterThan(1000);
    expect(mailer.sent).toHaveLength(1);
    const [mail] = mailer.sent;
    expect(mail!.to).toBe(HR_EMAIL);
    expect(mail!.text).toContain(`http://localhost:5173/exports/${body.exportId}`);
    expect(mail!.text).not.toContain('/api/');
    expect(mail!.text).toContain('2026-10-13');
    // No salary or employee data in the email.
    for (const secret of ['1234567', '98765', 'Asha', 'Verma', 'e1@acme.com']) {
      expect(mail!.subject + mail!.text).not.toContain(secret);
    }
    expect(await jobs('export_cleanup')).toEqual([
      { status: 'queued', runAfter: new Date('2026-10-13T09:00:00.000Z') },
    ]);
  });

  it('includes only the filtered employees', async () => {
    const { body } = await requestEmail({ country: 'US' });

    await worker.runOnce();

    expect((await exportRow(body.exportId)).rowCount).toBe(1);
    expect(mailer.sent).toHaveLength(1);
  });
});

describe('retrying the export job (T9)', () => {
  it('sends exactly one email when the job fails after sending, and does not rebuild the file', async () => {
    const { body } = await requestEmail();
    let completions = 0;
    const loseCompletion = {
      ...queue,
      complete: async (id: string) => {
        if (completions++ === 0) throw new Error('connection lost after the email went out');
        return queue.complete(id);
      },
    };

    await workerWith(loseCompletion).runOnce();
    const afterFirst = await exportRow(body.exportId);
    clock.advance(10_000);
    await worker.runOnce();

    expect(mailer.sent).toHaveLength(1);
    expect(await exportRow(body.exportId)).toEqual(afterFirst); // same file, same expiry
    expect(await jobs('export_cleanup')).toHaveLength(1);
    expect(await jobs('export_pdf')).toEqual([expect.objectContaining({ status: 'completed' })]);
  });

  it('sends exactly one email when the job fails before sending', async () => {
    const { body } = await requestEmail();
    mailer.failNext();

    await worker.runOnce();
    expect(mailer.sent).toHaveLength(0);
    expect((await exportRow(body.exportId)).emailSentAt).toBeNull();
    const fileAfterFirst = (await exportRow(body.exportId)).fileBytes;
    clock.advance(10_000);
    await worker.runOnce();

    expect(mailer.sent).toHaveLength(1);
    expect((await exportRow(body.exportId)).fileBytes).toBe(fileAfterFirst);
    expect(await jobs('export_cleanup')).toHaveLength(1);
  });

  it('marks the export failed when the job gives up', async () => {
    const { body } = await requestEmail();
    mailer.failNext(3);

    for (const wait of [0, 10_000, 20_000]) {
      clock.advance(wait);
      await worker.runOnce();
    }

    expect(await exportRow(body.exportId)).toMatchObject({
      status: 'failed',
      error: 'SMTP server unavailable',
      fileBytes: null,
    });
    expect(mailer.sent).toHaveLength(0);
  });
});
