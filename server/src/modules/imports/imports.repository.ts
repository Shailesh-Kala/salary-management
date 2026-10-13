import type { Pool, PoolClient } from 'pg';
import type { ImportForm } from './upload.ts';

export function importRepositories(db: Pool | PoolClient) {
  return {
    insert: async (
      i: ImportForm & {
        uploadedBy: string;
        fileName: string;
        file: Buffer;
        rowCount: number;
        createdAt: Date;
      },
    ) =>
      (
        await db.query<{ id: string }>(
          `INSERT INTO imports (uploaded_by, file_name, status, change_type, effective_date, note,
             file, row_count, created_at)
           VALUES ($1, $2, 'validating', $3, $4, $5, $6, $7, $8) RETURNING id`,
          [
            i.uploadedBy,
            i.fileName,
            i.changeType,
            i.effectiveDate,
            i.note,
            i.file,
            i.rowCount,
            i.createdAt,
          ],
        )
      ).rows[0]!.id,

    activeImportId: async () =>
      (
        await db.query<{ id: string }>(
          `SELECT id FROM imports WHERE status IN ('validating', 'awaiting_confirmation', 'applying')`,
        )
      ).rows[0]?.id ?? null,
  };
}

export type ImportRepos = ReturnType<typeof importRepositories>;
