import type { Pool } from 'pg';
import type { Clock } from '../lib/clock.ts';
import type { Logger } from 'pino';
import { withTransaction } from '../db/transaction.ts';
import type { Mailer } from '../lib/mailer.ts';
import { employeeRepositories } from '../modules/employees/employees.repository.ts';
import { createEmployeesService } from '../modules/employees/employees.service.ts';
import { createEmailedExportHandler } from '../modules/exports/email-job.ts';
import { exportRepositories } from '../modules/exports/exports.repository.ts';
import { createApplyImportHandler } from '../modules/imports/apply-job.ts';
import { importRepositories } from '../modules/imports/imports.repository.ts';
import { createValidateImportHandler } from '../modules/imports/validate-job.ts';
import type { Job } from './queue.ts';
import type { JobHandler } from './worker.ts';

/** Every background job type and what runs it; used by the server's worker and by tests. */
export function jobHandlers({
  db,
  clock,
  mailer,
  logger,
  appBaseUrl,
}: {
  db: Pool;
  clock: Clock;
  mailer: Mailer;
  logger: Logger;
  appBaseUrl: string;
}): Record<string, JobHandler> {
  const employees = createEmployeesService({
    clock,
    repos: employeeRepositories(db),
    inTransaction: (fn) => withTransaction(db, (client) => fn(employeeRepositories(client))),
  });
  const imports = importRepositories(db);
  const importId = (job: Job) => String(job.payload.importId);
  // A job that keeps failing ends its import, so it doesn't block new uploads forever.
  const failImport = {
    onGiveUp: (job: Job, error: string) => imports.markFailed(importId(job), error, clock.now()),
  };

  return {
    import_validate: Object.assign(createValidateImportHandler({ db, clock, logger }), failImport),
    import_apply: Object.assign(createApplyImportHandler({ db, clock, logger }), failImport),
    export_pdf: createEmailedExportHandler({ db, clock, mailer, employees, appBaseUrl }),
    /** Runs when the link expires; does nothing if the file is already gone. */
    export_cleanup: (job) =>
      exportRepositories(db).deleteExpiredFile(String(job.payload.exportId), clock.now()),
    /** Runs at the preview's deadline; does nothing if it was confirmed or cancelled first. */
    import_expire: (job) => imports.expireDue(clock.now(), importId(job)),
  };
}
