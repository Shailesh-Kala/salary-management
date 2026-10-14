import type { Logger } from 'pino';
import type { Job } from '../../jobs/queue.ts';

/**
 * Logs a row that failed in a way the rules did not expect (a bug or a database fault) and
 * returns the reason to show for that row. The reference names the job and row, so what a user
 * sees can be matched to this log line. Only the error's name and message are logged, never the
 * row: import rows hold pay and personal data.
 */
export function reportUnexpectedRow(logger: Logger, job: Job, rowNumber: number, err: unknown) {
  logger.error(
    {
      jobId: job.id,
      jobType: job.type,
      rowNumber,
      errorName: err instanceof Error ? err.name : typeof err,
      error: err instanceof Error ? err.message : String(err),
    },
    'import row failed unexpectedly',
  );
  return `Unexpected error: row not imported (ref ${job.id}/${rowNumber})`;
}
