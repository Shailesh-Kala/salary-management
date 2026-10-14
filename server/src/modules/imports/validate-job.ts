import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { withTransaction } from '../../db/transaction.ts';
import { createQueue } from '../../jobs/queue.ts';
import type { JobHandler } from '../../jobs/worker.ts';
import type { Clock } from '../../lib/clock.ts';
import { importRepositories } from './imports.repository.ts';
import { parseCsv } from './upload.ts';
import { reportUnexpectedRow } from './unexpected.ts';
import { countPreview, validateRows } from './validate-rows.ts';

/** HR has 24 hours to confirm or cancel a preview before it expires (D-031). */
export const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Checks every row without changing any employee, stores the preview, and schedules its expiry.
 * Safe to retry: an import that is no longer validating is left alone, and rows are replaced.
 */
export function createValidateImportHandler({
  db,
  clock,
  logger,
}: {
  db: Pool;
  clock: Clock;
  logger: Logger;
}): JobHandler {
  return async (job) => {
    const importId = String(job.payload.importId);
    const repos = importRepositories(db);
    const record = await repos.find(importId);
    if (!record || record.status !== 'validating' || !record.file) return;

    const [header = [], ...rows] = parseCsv(record.file);
    const form = {
      changeType: record.changeType,
      effectiveDate: record.effectiveDate,
      note: record.note,
    };
    // A row the rules cannot handle is rejected on its own, with a reference, so one bug does not
    // fail the whole preview.
    const results = validateRows(
      header,
      rows,
      await repos.validationContext(form, clock.today()),
      (err, rowNumber) => reportUnexpectedRow(logger, job, rowNumber, err),
    );
    const expiresAt = new Date(clock.now().getTime() + PREVIEW_TTL_MS);

    await withTransaction(db, async (client) => {
      const tx = importRepositories(client);
      if (!(await tx.markPreviewReady(importId, countPreview(results), expiresAt))) return;
      await tx.savePreviewRows(importId, results);
      await createQueue(client, clock).enqueue(
        'import_expire',
        { importId },
        { runAfter: expiresAt },
      );
    });
  };
}
