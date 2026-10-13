import type { Queue } from '../../jobs/queue.ts';
import type { Clock } from '../../lib/clock.ts';
import { AppError, invalidField } from '../../lib/errors.ts';
import type { AuthUser } from '../auth/auth.service.ts';
import type { ImportRepos } from './imports.repository.ts';
import { checkUpload, type ImportForm, templateCsv } from './upload.ts';

export type ImportsServiceDeps = {
  clock: Clock;
  repos: ImportRepos;
  /** Import repositories and a queue on one transaction, so the job is queued only if stored. */
  inTransaction: <T>(fn: (tx: { imports: ImportRepos; queue: Queue }) => Promise<T>) => Promise<T>;
};

const isActiveImportConflict = (err: unknown) =>
  (err as { code?: string; constraint?: string }).code === '23505' &&
  (err as { constraint?: string }).constraint === 'one_active_import';

export function createImportsService({ clock, repos, inTransaction }: ImportsServiceDeps) {
  return {
    template: templateCsv,

    /** Runs the upload checks, stores the file and queues validation (202); one import at a time. */
    async upload(
      file: { originalname: string; buffer: Buffer } | undefined,
      form: ImportForm,
      actor: AuthUser,
    ) {
      if (form.effectiveDate > clock.today()) {
        throw invalidField('effectiveDate', 'Effective date cannot be in the future');
      }
      const { rowCount } = checkUpload(file);
      try {
        return await inTransaction(async ({ imports, queue }) => {
          const id = await imports.insert({
            ...form,
            uploadedBy: actor.id,
            fileName: file!.originalname,
            file: file!.buffer,
            rowCount,
            createdAt: clock.now(),
          });
          await queue.enqueue('import_validate', { importId: id });
          return { id, status: 'validating' as const, rowCount };
        });
      } catch (err) {
        if (!isActiveImportConflict(err)) throw err;
        throw new AppError(
          'IMPORT_IN_PROGRESS',
          409,
          'Another import is in progress. Finish or cancel it before uploading a new file.',
          { importId: await repos.activeImportId() },
        );
      }
    },
  };
}

export type ImportsService = ReturnType<typeof createImportsService>;
