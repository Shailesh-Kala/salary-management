import type { Pool } from 'pg';
import type { Clock } from '../lib/clock.ts';
import { createApplyImportHandler } from '../modules/imports/apply-job.ts';
import { createValidateImportHandler } from '../modules/imports/validate-job.ts';
import type { JobHandler } from './worker.ts';

/** Every background job type and what runs it; used by the server's worker and by tests. */
export function jobHandlers({ db, clock }: { db: Pool; clock: Clock }): Record<string, JobHandler> {
  return {
    import_validate: createValidateImportHandler({ db, clock }),
    import_apply: createApplyImportHandler({ db, clock }),
  };
}
