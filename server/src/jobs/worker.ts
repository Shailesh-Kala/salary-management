import type { Logger } from 'pino';
import type { Job, Queue } from './queue.ts';

/** Must be idempotent: a retried job re-runs it after a crash part-way through (D-020). */
export type JobHandler = (job: Job) => Promise<void>;

// ponytail: one serial worker in the API process; run several or a separate process if job
// volume ever grows (D-030).
export function createWorker({
  queue,
  handlers,
  logger,
  pollIntervalMs = 1000,
}: {
  queue: Queue;
  handlers: Record<string, JobHandler>;
  logger: Logger;
  pollIntervalMs?: number;
}) {
  let running = false;
  let loop: Promise<void> | undefined;
  let wake: (() => void) | undefined;

  /** Runs one due job if there is one; returns whether it did. */
  async function runOnce() {
    const job = await queue.claim();
    if (!job) return false;
    const log = logger.child({ jobId: job.id, jobType: job.type, attempt: job.attempts });
    const handler = handlers[job.type];

    if (!handler) {
      await queue.fail(job, `No handler for job type ${job.type}`, { permanent: true });
      log.error('job failed: no handler');
      return true;
    }
    if (job.attempts > job.maxAttempts) {
      await queue.fail(job, `Abandoned after ${job.maxAttempts} attempts`, { permanent: true });
      log.error('job failed: its last attempt was abandoned');
      return true;
    }
    try {
      await handler(job);
      await queue.complete(job.id);
      log.info('job completed');
    } catch (err) {
      // Messages only: job errors must not carry employee data into logs.
      const message = err instanceof Error ? err.message : String(err);
      await queue.fail(job, message);
      log.error({ error: message }, 'job attempt failed');
    }
    return true;
  }

  const sleep = () =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, pollIntervalMs);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });

  return {
    runOnce,

    start() {
      running = true;
      loop = (async () => {
        while (running) {
          let worked = false;
          try {
            worked = await runOnce();
          } catch (err) {
            logger.error({ err }, 'worker could not claim a job');
          }
          if (!worked && running) await sleep();
        }
      })();
    },

    /** Stops polling and waits for the job in progress to finish. */
    async stop() {
      running = false;
      wake?.();
      await loop;
    },
  };
}

export type Worker = ReturnType<typeof createWorker>;
