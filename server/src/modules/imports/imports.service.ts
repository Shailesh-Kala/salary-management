import type { Queue } from '../../jobs/queue.ts';
import type { Clock } from '../../lib/clock.ts';
import { AppError, invalidField } from '../../lib/errors.ts';
import type { AuthUser } from '../auth/auth.service.ts';
import type { ImportRepos } from './imports.repository.ts';
import { stringify } from 'csv-stringify/sync';
import { checkUpload, type ImportForm, TEMPLATE_HEADER, templateCsv } from './upload.ts';

const BOM = String.fromCharCode(0xfeff); // so Excel opens UTF-8 correctly
const PREVIEW_REJECTED_LIMIT = 100;

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
  const notFound = () => new AppError('NOT_FOUND', 404, 'Import not found');

  /** 404 if the import doesn't exist, otherwise 409: it is in the wrong state for `action`. */
  const refuse = async (id: string, action: string) => {
    if (!(await repos.find(id))) throw notFound();
    throw new AppError('INVALID_STATE', 409, `This import can no longer be ${action}`);
  };

  return {
    template: templateCsv,

    /** Any HR user may cancel while it is validating or waiting; nothing is written (T2). */
    async cancel(id: string) {
      const cancelled = await repos.transition(
        id,
        ['validating', 'awaiting_confirmation'],
        'cancelled',
        clock.now(),
        { finished: true },
      );
      if (!cancelled) await refuse(id, 'cancelled');
      return this.get(id);
    },

    /** Starts applying the valid rows in the background; the confirmer is the changes' author. */
    async confirm(id: string, actor: AuthUser) {
      const confirmed = await inTransaction(async ({ imports, queue }) => {
        const moved = await imports.transition(
          id,
          ['awaiting_confirmation'],
          'applying',
          clock.now(),
          {
            confirmedBy: actor.id,
          },
        );
        if (moved) await queue.enqueue('import_apply', { importId: id });
        return moved;
      });
      if (!confirmed) await refuse(id, 'confirmed');
      return this.get(id);
    },

    /** Status, counts and the first rejected rows with their reasons. */
    async get(id: string) {
      const details = await repos.details(id);
      if (!details) throw notFound();
      const rejected = await repos.rejectedRows(id, PREVIEW_REJECTED_LIMIT);
      return {
        ...details,
        rejected: rejected.map(({ rowNumber, employeeCode, errors }) => ({
          rowNumber,
          employeeCode,
          errors,
        })),
      };
    },

    /**
     * Rejected rows with their original values plus an `error` column, so HR can fix them and
     * upload this file again. Values are kept exactly as uploaded (no formula escaping) so the
     * round trip is lossless; they came from HR's own file.
     */
    async rejectedCsv(id: string) {
      const record = await repos.find(id);
      if (!record) throw notFound();
      const rows = await repos.rejectedRows(id);
      const lines = rows
        .filter((r) => r.raw)
        .map((r) => [
          ...TEMPLATE_HEADER.map((column) => r.raw![column] ?? ''),
          r.errors.join('; '),
        ]);
      return {
        filename: `${record.fileName.replace(/\.csv$/i, '')}-rejected.csv`,
        content: BOM + stringify([[...TEMPLATE_HEADER, 'error'], ...lines]),
      };
    },

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
