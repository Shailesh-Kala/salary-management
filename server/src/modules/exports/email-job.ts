import type { Pool } from 'pg';
import { withTransaction } from '../../db/transaction.ts';
import { createQueue } from '../../jobs/queue.ts';
import type { JobHandler } from '../../jobs/worker.ts';
import type { Clock } from '../../lib/clock.ts';
import type { Mailer } from '../../lib/mailer.ts';
import type { EmployeeListItem } from '../employees/employees.repository.ts';
import type { EmployeesService } from '../employees/employees.service.ts';
import { exportRepositories } from './exports.repository.ts';
import type { ExportFilters } from './exports.service.ts';
import { describeFilters, renderEmployeeListPdf } from './list-pdf.ts';

/** The emailed link works for 24 hours; the file is deleted then (D-018). */
export const EXPORT_TTL_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 1000;

type Deps = {
  db: Pool;
  clock: Clock;
  mailer: Mailer;
  employees: Pick<EmployeesService, 'list'>;
  appBaseUrl: string;
};

async function renderPdf(filters: ExportFilters, { employees, clock }: Deps) {
  const rows: EmployeeListItem[] = [];
  let page = await employees.list({ ...filters, page: 1, pageSize: BATCH_SIZE });
  rows.push(...page.items);
  for (let n = 2; rows.length < page.total; n++) {
    page = await employees.list({ ...filters, page: n, pageSize: BATCH_SIZE });
    rows.push(...page.items);
  }
  return renderEmployeeListPdf(rows, {
    currency: page.currency,
    ratesAsOf: page.ratesAsOf,
    filters: describeFilters(filters),
    generatedAt: clock.now(),
  });
}

/** The email carries a link to the app page only: no attachment and no employee or pay data. */
const emailText = (link: string, expiresAt: Date) =>
  `Your employee export is ready.\n\nOpen it here (sign in if asked): ${link}\n\n` +
  `Only you can download it, and the link stops working at ${expiresAt.toISOString()}, ` +
  `when the file is deleted.\n`;

/**
 * Builds the PDF once, then emails the requester a link. Safe to retry (D-020): an existing file
 * is kept, and the email is claimed before it is sent so it goes out at most once; a failed
 * send gives the claim back so the retry can send.
 */
export function createEmailedExportHandler(deps: Deps): JobHandler {
  const { db, clock, mailer, appBaseUrl } = deps;
  const handler: JobHandler = async (job) => {
    const exportId = String(job.payload.exportId);
    const repos = exportRepositories(db);
    const record = await repos.findForJob(exportId);
    if (!record || record.status === 'failed') return;

    if (record.status === 'queued') {
      const pdf = await renderPdf(record.filters as ExportFilters, deps);
      const expiresAt = new Date(clock.now().getTime() + EXPORT_TTL_MS);
      await withTransaction(db, async (client) => {
        const saved = await exportRepositories(client).saveFile(
          exportId,
          pdf,
          `employees-${clock.today()}.pdf`,
          expiresAt,
        );
        if (saved) {
          await createQueue(client, clock).enqueue(
            'export_cleanup',
            { exportId },
            { runAfter: expiresAt },
          );
        }
      });
    }

    const ready = (await repos.findForJob(exportId))!;
    if (!ready.hasFile || !(await repos.claimEmail(exportId, clock.now()))) return;
    try {
      await mailer.send({
        to: ready.requesterEmail,
        subject: 'Your employee export is ready',
        text: emailText(`${appBaseUrl}/exports/${exportId}`, ready.expiresAt!),
      });
    } catch (err) {
      await repos.releaseEmail(exportId);
      throw err;
    }
  };
  handler.onGiveUp = (job, error) =>
    exportRepositories(db).markFailed(String(job.payload.exportId), error);
  return handler;
}
