import type { Pool, PoolClient } from 'pg';

type NewExport = {
  requestedBy: string;
  format: string;
  delivery: 'direct' | 'email';
  filters: object;
  rowCount: number;
  createdAt: Date;
};

export function exportRepositories(db: Pool | PoolClient) {
  return {
    recordExport: async (e: NewExport) => {
      await db.query(
        `INSERT INTO exports (requested_by, format, delivery, filters, row_count, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [e.requestedBy, e.format, e.delivery, JSON.stringify(e.filters), e.rowCount, e.createdAt],
      );
    },

    /** An emailed export waiting for its background job. */
    queueEmailed: async (e: Omit<NewExport, 'delivery'>) =>
      (
        await db.query<{ id: string }>(
          `INSERT INTO exports (requested_by, format, delivery, status, filters, row_count, created_at)
           VALUES ($1, $2, 'email', 'queued', $3, $4, $5) RETURNING id`,
          [e.requestedBy, e.format, JSON.stringify(e.filters), e.rowCount, e.createdAt],
        )
      ).rows[0]!.id,

    /** What the job needs: the filters, who asked (and their address), and any file built so far. */
    findForJob: async (id: string) =>
      (
        await db.query<{
          id: string;
          status: string;
          filters: Record<string, unknown>;
          hasFile: boolean;
          expiresAt: Date | null;
          requesterEmail: string;
        }>(
          `SELECT e.id, e.status, e.filters, e.file IS NOT NULL AS "hasFile",
                  e.expires_at AS "expiresAt", u.email AS "requesterEmail"
             FROM exports e JOIN hr_users u ON u.id = e.requested_by
            WHERE e.id = $1`,
          [id],
        )
      ).rows[0] ?? null,

    /** Stores the built file; false if another run already did (the file is never replaced). */
    saveFile: async (id: string, file: Buffer, fileName: string, expiresAt: Date) =>
      (
        await db.query(
          `UPDATE exports SET status = 'ready', file = $2, file_name = $3, expires_at = $4
            WHERE id = $1 AND status = 'queued'`,
          [id, file, fileName, expiresAt],
        )
      ).rowCount === 1,

    /** Takes the right to send the email: true for the first caller only. */
    claimEmail: async (id: string, now: Date) =>
      (
        await db.query(
          'UPDATE exports SET email_sent_at = $2 WHERE id = $1 AND email_sent_at IS NULL',
          [id, now],
        )
      ).rowCount === 1,

    /** Gives the right back after a failed send, so a retry can send. */
    releaseEmail: async (id: string) => {
      await db.query('UPDATE exports SET email_sent_at = NULL WHERE id = $1', [id]);
    },

    /** Who may download, and whether the file is still there (the file itself is not loaded). */
    findForDownload: async (id: string) =>
      (
        await db.query<{
          requestedBy: string;
          status: string;
          expiresAt: Date | null;
          deletedAt: Date | null;
        }>(
          `SELECT requested_by AS "requestedBy", status, expires_at AS "expiresAt",
                  deleted_at AS "deletedAt"
             FROM exports WHERE id = $1 AND delivery = 'email'`,
          [id],
        )
      ).rows[0] ?? null,

    /** The user's emailed exports, newest first (the files themselves are not loaded). */
    listEmailed: async (userId: string, limit: number) =>
      (
        await db.query(
          `SELECT id, status, row_count AS "rowCount", created_at AS "createdAt",
                  expires_at AS "expiresAt", deleted_at AS "deletedAt", error
             FROM exports
            WHERE requested_by = $1 AND delivery = 'email'
            ORDER BY created_at DESC, id DESC
            LIMIT $2`,
          [userId, limit],
        )
      ).rows,

    readFile: async (id: string) =>
      (
        await db.query<{ file: Buffer | null; fileName: string }>(
          'SELECT file, file_name AS "fileName" FROM exports WHERE id = $1',
          [id],
        )
      ).rows[0] ?? null,

    recordDownload: async (
      id: string,
      userId: string,
      outcome: 'downloaded' | 'forbidden' | 'expired',
      at: Date,
    ) => {
      await db.query(
        'INSERT INTO export_downloads (export_id, user_id, outcome, at) VALUES ($1, $2, $3, $4)',
        [id, userId, outcome, at],
      );
    },

    /** Deletes the file once the link has expired; does nothing if it is already gone. */
    deleteExpiredFile: async (id: string, now: Date) => {
      await db.query(
        `UPDATE exports SET file = NULL, deleted_at = $2
          WHERE id = $1 AND file IS NOT NULL AND expires_at <= $2`,
        [id, now],
      );
    },

    /** Ends an export that will never be emailed; its file (if built) is dropped. */
    markFailed: async (id: string, error: string) => {
      await db.query(
        `UPDATE exports SET status = 'failed', error = $2, file = NULL
          WHERE id = $1 AND status IN ('queued', 'ready')`,
        [id, error],
      );
    },
  };
}

export type ExportRepos = ReturnType<typeof exportRepositories>;
