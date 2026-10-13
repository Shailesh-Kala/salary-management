import type { Pool } from 'pg';
import type { Clock } from '../lib/clock.ts';
import { withTransaction } from '../db/transaction.ts';
import type { Mailer } from '../lib/mailer.ts';
import { employeeRepositories } from '../modules/employees/employees.repository.ts';
import { createEmployeesService } from '../modules/employees/employees.service.ts';
import { createEmailedExportHandler } from '../modules/exports/email-job.ts';
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
  appBaseUrl,
}: {
  db: Pool;
  clock: Clock;
  mailer: Mailer;
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
    import_validate: Object.assign(createValidateImportHandler({ db, clock }), failImport),
    import_apply: Object.assign(createApplyImportHandler({ db, clock }), failImport),
    export_pdf: createEmailedExportHandler({ db, clock, mailer, employees, appBaseUrl }),
    /** Runs at the preview's deadline; does nothing if it was confirmed or cancelled first. */
    import_expire: (job) => imports.expireDue(clock.now(), importId(job)),
  };
}
