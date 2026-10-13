import { pino } from 'pino';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, fixedClock, type TestClock } from '../../../test/app.ts';
import { logIn, signIn } from '../../../test/auth.ts';
import { resetDb, testPool } from '../../../test/db.ts';
import { insertEmployee } from '../../../test/factories.ts';
import { testJobHandlers } from '../../../test/handlers.ts';
import { createQueue } from '../../jobs/queue.ts';
import { createWorker } from '../../jobs/worker.ts';

const HOUR = 60 * 60 * 1000;
const OWNER = 'hr@acme.local';
const OTHER = 'colleague@acme.local';

let app: ReturnType<typeof buildTestApp>;
let clock: TestClock;
let owner: { cookie: string; user: { id: string } };
let other: { cookie: string; user: { id: string } };
let worker: ReturnType<typeof createWorker>;
let exportId: string;

beforeEach(async () => {
  await resetDb();
  clock = fixedClock(); // 2026-10-12T09:00:00Z
  app = buildTestApp({ clock });
  owner = await signIn(app, OWNER);
  other = await signIn(app, OTHER);
  worker = createWorker({
    queue: createQueue(testPool, clock),
    handlers: testJobHandlers({ clock }),
    logger: pino({ level: 'silent' }),
  });
  await insertEmployee({ employeeCode: 'EMP-1', email: 'e1@acme.com' });

  const res = await request(app)
    .post('/api/exports/employees/email')
    .set('Cookie', owner.cookie)
    .send({});
  exportId = res.body.exportId;
  await worker.runOnce(); // builds the PDF and sends the email
});
afterAll(() => testPool.end());

const download = (cookie: string, id = exportId) =>
  request(app)
    .get(`/api/exports/${id}/download`)
    .set('Cookie', cookie)
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
const audit = async () =>
  (
    await testPool.query(
      `SELECT user_id AS "userId", outcome, at FROM export_downloads
        WHERE export_id = $1 ORDER BY id`,
      [exportId],
    )
  ).rows;
const exportRow = async () =>
  (
    await testPool.query(
      'SELECT file IS NOT NULL AS "hasFile", deleted_at AS "deletedAt" FROM exports WHERE id = $1',
      [exportId],
    )
  ).rows[0];

describe('GET /api/exports/:id/download', () => {
  it('gives the requester the PDF and audits the download', async () => {
    const res = await download(owner.cookie);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="employees-2026-10-12.pdf"',
    );
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect(await audit()).toEqual([
      { userId: owner.user.id, outcome: 'downloaded', at: new Date('2026-10-12T09:00:00.000Z') },
    ]);
  });

  it('refuses another HR user with 403, audits it, and returns no file (T4)', async () => {
    const res = await download(other.cookie);

    expect(res.status).toBe(403);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(JSON.parse((res.body as Buffer).toString()).error.code).toBe('FORBIDDEN');
    expect(await audit()).toEqual([
      expect.objectContaining({ userId: other.user.id, outcome: 'forbidden' }),
    ]);
  });

  it('refuses the requester after the link expires with 410 and audits it (T5)', async () => {
    clock.advance(24 * HOUR);
    const cookie = await logIn(app, OWNER); // the 8-hour session has ended by now

    const res = await download(cookie);

    expect(res.status).toBe(410);
    expect(JSON.parse((res.body as Buffer).toString()).error).toMatchObject({
      code: 'GONE',
      message: 'This export link has expired. Request the export again.',
    });
    expect(await audit()).toEqual([
      expect.objectContaining({ userId: owner.user.id, outcome: 'expired' }),
    ]);
  });

  it('is 404 for an unknown or malformed id, and for a direct (non-emailed) export', async () => {
    const direct = await request(app)
      .get('/api/exports/employees?format=csv')
      .set('Cookie', owner.cookie);
    const { rows } = await testPool.query("SELECT id FROM exports WHERE delivery = 'direct'");

    expect(direct.status).toBe(200);
    expect((await download(owner.cookie, rows[0].id)).status).toBe(404);
    expect((await download(owner.cookie, 'a1b2c3d4-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await download(owner.cookie, 'not-a-uuid')).status).toBe(404);
  });

  it('says a queued export is not ready yet, and a failed one is gone', async () => {
    const queued = await request(app)
      .post('/api/exports/employees/email')
      .set('Cookie', owner.cookie)
      .send({});
    expect((await download(owner.cookie, queued.body.exportId)).status).toBe(409);

    await testPool.query("UPDATE exports SET status = 'failed', file = NULL WHERE id = $1", [
      queued.body.exportId,
    ]);
    expect((await download(owner.cookie, queued.body.exportId)).status).toBe(410);
  });

  it('requires a session', async () => {
    expect((await request(app).get(`/api/exports/${exportId}/download`)).status).toBe(401);
  });

  it('keeps the audit trail append-only', async () => {
    await download(owner.cookie);

    await expect(testPool.query('DELETE FROM export_downloads')).rejects.toThrow(/append-only/);
    await expect(
      testPool.query("UPDATE export_downloads SET outcome = 'forbidden'"),
    ).rejects.toThrow(/append-only/);
  });
});

describe('GET /api/exports', () => {
  const list = (cookie: string) => request(app).get('/api/exports').set('Cookie', cookie);

  it("lists the requester's emailed exports, newest first, with their state", async () => {
    clock.advance(60_000);
    const second = await request(app)
      .post('/api/exports/employees/email')
      .set('Cookie', owner.cookie)
      .send({ country: 'IN' });
    await request(app).get('/api/exports/employees?format=csv').set('Cookie', owner.cookie);

    const res = await list(owner.cookie);

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      {
        id: second.body.exportId,
        status: 'queued',
        rowCount: 1,
        createdAt: '2026-10-12T09:01:00.000Z',
        expiresAt: null,
        deletedAt: null,
        error: null,
      },
      {
        id: exportId,
        status: 'ready',
        rowCount: 1,
        createdAt: '2026-10-12T09:00:00.000Z',
        expiresAt: '2026-10-13T09:00:00.000Z',
        deletedAt: null,
        error: null,
      },
    ]);
  });

  it("does not show other people's exports, and requires a session", async () => {
    expect((await list(other.cookie)).body.items).toEqual([]);
    expect((await request(app).get('/api/exports')).status).toBe(401);
  });
});

describe('the export_cleanup job (T6)', () => {
  it('deletes the file at expiry, and running it again changes nothing', async () => {
    clock.advance(24 * HOUR);
    await worker.runOnce(); // the cleanup job is due now
    const afterFirst = await exportRow();

    const handler = testJobHandlers({ clock }).export_cleanup!;
    clock.advance(HOUR);
    await handler({
      id: 'again',
      type: 'export_cleanup',
      payload: { exportId },
      attempts: 1,
      maxAttempts: 3,
    });

    expect(afterFirst).toEqual({ hasFile: false, deletedAt: new Date('2026-10-13T09:00:00.000Z') });
    expect(await exportRow()).toEqual(afterFirst);
  });

  it('keeps the file if it runs before the link has expired', async () => {
    const handler = testJobHandlers({ clock }).export_cleanup!;

    await handler({
      id: 'early',
      type: 'export_cleanup',
      payload: { exportId },
      attempts: 1,
      maxAttempts: 3,
    });

    expect(await exportRow()).toEqual({ hasFile: true, deletedAt: null });
  });

  it('makes a later download attempt 410 and audited', async () => {
    clock.advance(24 * HOUR);
    await worker.runOnce();
    const cookie = await logIn(app, OWNER);

    const res = await download(cookie);

    expect(res.status).toBe(410);
    expect(await audit()).toEqual([expect.objectContaining({ outcome: 'expired' })]);
  });
});
