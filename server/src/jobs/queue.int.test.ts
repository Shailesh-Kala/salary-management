import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pino } from 'pino';
import { fixedClock, type TestClock } from '../../test/app.ts';
import { resetDb, testPool } from '../../test/db.ts';
import { createQueue } from './queue.ts';
import { createWorker, type JobHandler } from './worker.ts';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const logger = pino({ level: 'silent' });

let clock: TestClock;
let queue: ReturnType<typeof createQueue>;

beforeEach(async () => {
  await resetDb();
  clock = fixedClock();
  queue = createQueue(testPool, clock);
});
afterAll(() => testPool.end());

const job = async (id: string) =>
  (
    await testPool.query(
      'SELECT status, attempts, run_after AS "runAfter", last_error AS "lastError" FROM jobs WHERE id = $1',
      [id],
    )
  ).rows[0];

const workerWith = (handlers: Record<string, JobHandler>) =>
  createWorker({ queue, handlers, logger });

describe('job queue', () => {
  it('runs a queued job with its payload and marks it completed', async () => {
    const handler = vi.fn(async () => {});
    const id = await queue.enqueue('import_validate', { importId: 'i-1' });
    const worker = workerWith({ import_validate: handler });

    expect(await worker.runOnce()).toBe(true);
    expect(await worker.runOnce()).toBe(false);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        id,
        type: 'import_validate',
        payload: { importId: 'i-1' },
        attempts: 1,
      }),
    );
    expect(await job(id)).toMatchObject({ status: 'completed', attempts: 1 });
  });

  it('does not run a delayed job before its run_after time', async () => {
    const handler = vi.fn(async () => {});
    const id = await queue.enqueue(
      'export_cleanup',
      {},
      { runAfter: new Date(clock.now().getTime() + 24 * 60 * MINUTE) },
    );
    const worker = workerWith({ export_cleanup: handler });

    expect(await worker.runOnce()).toBe(false);
    clock.advance(24 * 60 * MINUTE - SECOND);
    expect(await worker.runOnce()).toBe(false);
    clock.advance(SECOND);
    expect(await worker.runOnce()).toBe(true);

    expect(await job(id)).toMatchObject({ status: 'completed' });
  });

  it('retries a failing job with growing backoff, then marks it failed after 3 attempts', async () => {
    const handler = vi.fn(async () => {
      throw new Error('upstream unavailable');
    });
    const id = await queue.enqueue('export_pdf', {});
    const worker = workerWith({ export_pdf: handler });

    expect(await worker.runOnce()).toBe(true);
    expect(await job(id)).toMatchObject({
      status: 'queued',
      attempts: 1,
      runAfter: new Date(clock.now().getTime() + 10 * SECOND),
      lastError: 'upstream unavailable',
    });
    expect(await worker.runOnce()).toBe(false); // backing off

    clock.advance(10 * SECOND);
    expect(await worker.runOnce()).toBe(true);
    expect(await job(id)).toMatchObject({
      status: 'queued',
      attempts: 2,
      runAfter: new Date(clock.now().getTime() + 20 * SECOND),
    });

    clock.advance(20 * SECOND);
    expect(await worker.runOnce()).toBe(true);
    expect(await job(id)).toMatchObject({
      status: 'failed',
      attempts: 3,
      lastError: 'upstream unavailable',
    });
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('re-claims a job whose worker died, once its 5-minute lease has expired', async () => {
    const handler = vi.fn(async () => {});
    const id = await queue.enqueue('import_apply', {});
    await queue.claim(); // a worker took it and crashed without finishing
    const worker = workerWith({ import_apply: handler });

    expect(await worker.runOnce()).toBe(false);
    clock.advance(5 * MINUTE + SECOND);
    expect(await worker.runOnce()).toBe(true);

    expect(handler).toHaveBeenCalledOnce();
    expect(await job(id)).toMatchObject({ status: 'completed', attempts: 2 });
  });

  it('marks a job failed without running it again when its last attempt was abandoned', async () => {
    const handler = vi.fn(async () => {});
    const id = await queue.enqueue('import_apply', {});
    for (let attempt = 0; attempt < 3; attempt++) {
      await queue.claim(); // claimed, then the worker died
      clock.advance(5 * MINUTE + SECOND);
    }

    expect(await workerWith({ import_apply: handler }).runOnce()).toBe(true);

    expect(handler).not.toHaveBeenCalled();
    expect(await job(id)).toMatchObject({
      status: 'failed',
      lastError: 'Abandoned after 3 attempts',
    });
  });

  it('fails a job with no handler straight away', async () => {
    const id = await queue.enqueue('unknown_type', {});

    await workerWith({}).runOnce();

    expect(await job(id)).toMatchObject({
      status: 'failed',
      lastError: 'No handler for job type unknown_type',
    });
  });

  it('never gives the same job to two concurrent claims', async () => {
    const first = await queue.enqueue('a', {});
    const second = await queue.enqueue('a', {});

    const claims = await Promise.all([queue.claim(), queue.claim(), queue.claim()]);

    const ids = claims
      .filter(Boolean)
      .map((j) => j!.id)
      .sort();
    expect(ids).toEqual([first, second].sort());
  });
});

describe('worker loop', () => {
  it('keeps polling until stopped, then finishes cleanly', async () => {
    const handled: string[] = [];
    const worker = createWorker({
      queue,
      handlers: { a: async (j) => void handled.push(j.id) },
      logger,
      pollIntervalMs: 5,
    });
    worker.start();

    const id = await queue.enqueue('a', {});
    await vi.waitFor(() => expect(handled).toEqual([id]), { timeout: 2000 });
    await worker.stop();

    expect(await job(id)).toMatchObject({ status: 'completed' });
  });
});
