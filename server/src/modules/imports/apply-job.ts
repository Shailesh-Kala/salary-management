import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../../db/transaction.ts';
import type { JobHandler } from '../../jobs/worker.ts';
import type { Clock } from '../../lib/clock.ts';
import { isInfrastructureError } from '../../lib/infrastructure-error.ts';
import { employeeRepositories } from '../employees/employees.repository.ts';
import { type ImportRecord, importRepositories } from './imports.repository.ts';
import { TEMPLATE_HEADER } from './upload.ts';
import { validateRows } from './validate-rows.ts';

type PendingRow = Awaited<ReturnType<ReturnType<typeof importRepositories>['pendingRows']>>[number];

/**
 * Applies a confirmed import, one transaction per row (D-019): each row is re-checked against
 * current data, written with its history entry, and its outcome saved in the same transaction,
 * so a retry skips finished rows (D-020). A row that fails unexpectedly is rejected on its own;
 * only infrastructure errors fail the job so it is retried (D-037).
 */
export function createApplyImportHandler({ db, clock }: { db: Pool; clock: Clock }): JobHandler {
  return async (job) => {
    const importId = String(job.payload.importId);
    const repos = importRepositories(db);
    const record = await repos.find(importId);
    if (!record || record.status !== 'applying') return;
    const currencyByCountry = await repos.countries();

    for (const row of await repos.pendingRows(importId)) {
      if (row.previewOutcome === 'rejected') {
        await repos.recordOutcome(importId, row.rowNumber, 'rejected', row.errors, clock.now());
        continue;
      }
      try {
        await withTransaction(db, (client) =>
          applyRow(client, record, row, currencyByCountry, clock),
        );
      } catch (err) {
        if (isInfrastructureError(err)) throw err;
        const reason = `Unexpected error: row not imported (ref ${job.id}/${row.rowNumber})`;
        await repos.recordOutcome(importId, row.rowNumber, 'rejected', [reason], clock.now());
      }
    }
    await repos.complete(importId, clock.now());
  };
}

async function applyRow(
  client: PoolClient,
  record: ImportRecord,
  row: PendingRow,
  currencyByCountry: Map<string, string>,
  clock: Clock,
) {
  const imports = importRepositories(client);
  const { employees, changes } = employeeRepositories(client);
  const form = {
    changeType: record.changeType,
    effectiveDate: record.effectiveDate,
    note: record.note,
  };
  const values = TEMPLATE_HEADER.map((column) => row.raw[column] ?? '');
  const code = values[0]!.trim().toUpperCase();
  const email = values[3]!.trim().toLowerCase();
  const ctx = await imports.rowContext(form, clock.today(), code, email, currencyByCountry);
  const [result] = validateRows([...TEMPLATE_HEADER], [values], ctx);
  const now = clock.now();

  let outcome: string = result!.outcome;
  let employeeId = ctx.employeesByCode.get(code)?.id;
  if (result!.outcome === 'create') {
    employeeId = (await employees.insert(result!.employee!)).id;
    outcome = 'created';
  } else if (result!.outcome === 'update') {
    await employees.updateFields(
      employeeId!,
      { ...result!.profile, ...result!.updates } as Record<string, string>,
      now,
    );
    outcome = 'updated';
  }
  if (result!.change) {
    await changes.insert({
      ...result!.change,
      employeeId: employeeId!,
      source: 'import',
      changedBy: record.confirmedBy!,
      changedAt: now,
      importId: record.id,
      importRowNumber: row.rowNumber,
    });
  }
  await imports.recordOutcome(record.id, row.rowNumber, outcome, result!.errors, now);
}
