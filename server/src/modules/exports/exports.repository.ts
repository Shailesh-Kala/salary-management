import type { Pool } from 'pg';

export function exportRepositories(db: Pool) {
  return {
    recordExport: async (e: {
      requestedBy: string;
      format: string;
      delivery: 'direct' | 'email';
      filters: object;
      rowCount: number;
      createdAt: Date;
    }) => {
      await db.query(
        `INSERT INTO exports (requested_by, format, delivery, filters, row_count, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [e.requestedBy, e.format, e.delivery, JSON.stringify(e.filters), e.rowCount, e.createdAt],
      );
    },
  };
}

export type ExportRepos = ReturnType<typeof exportRepositories>;
