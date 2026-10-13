import type { Pool, PoolClient } from 'pg';
import type { Clock } from '../lib/clock.ts';

export type Job = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
};

/** A claimed job is leased; if its worker dies, the job is claimed again once the lease ends. */
const LEASE_MS = 5 * 60_000;
/** Retry n waits n × 10 s. */
const BACKOFF_MS = 10_000;

/**
 * PostgreSQL-backed job queue (D-030). Every time comes from the injected clock and is passed to
 * SQL as a parameter, so tests control "now". Pass a transaction's client to enqueue atomically
 * with other writes.
 */
export function createQueue(db: Pool | PoolClient, clock: Clock) {
  const after = (ms: number) => new Date(clock.now().getTime() + ms);

  return {
    async enqueue(type: string, payload: object, { runAfter }: { runAfter?: Date } = {}) {
      const now = clock.now();
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO jobs (type, payload, run_after, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $4) RETURNING id::text AS id`,
        [type, JSON.stringify(payload), runAfter ?? now, now],
      );
      return rows[0]!.id;
    },

    /** Takes the next due job (or one whose lease expired); concurrent claims never share a job. */
    async claim(): Promise<Job | null> {
      const { rows } = await db.query<Job>(
        `UPDATE jobs
            SET status = 'running', attempts = attempts + 1, locked_until = $2, updated_at = $1
          WHERE id = (
            SELECT id FROM jobs
             WHERE (status = 'queued' AND run_after <= $1)
                OR (status = 'running' AND locked_until < $1)
             ORDER BY run_after, id
             LIMIT 1
               FOR UPDATE SKIP LOCKED)
          RETURNING id::text AS id, type, payload, attempts, max_attempts AS "maxAttempts"`,
        [clock.now(), after(LEASE_MS)],
      );
      return rows[0] ?? null;
    },

    async complete(id: string) {
      await db.query(
        `UPDATE jobs SET status = 'completed', locked_until = NULL, updated_at = $2 WHERE id = $1`,
        [id, clock.now()],
      );
    },

    /** Re-queues with backoff, or marks failed when attempts are used up or `permanent`. */
    async fail(job: Job, message: string, { permanent = false }: { permanent?: boolean } = {}) {
      const giveUp = permanent || job.attempts >= job.maxAttempts;
      await db.query(
        `UPDATE jobs
            SET status = $2, run_after = $3, last_error = $4, locked_until = NULL, updated_at = $5
          WHERE id = $1`,
        [
          job.id,
          giveUp ? 'failed' : 'queued',
          after(job.attempts * BACKOFF_MS),
          message,
          clock.now(),
        ],
      );
    },
  };
}

export type Queue = ReturnType<typeof createQueue>;
