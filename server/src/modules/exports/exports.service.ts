import type { Clock } from '../../lib/clock.ts';
import type { AuthUser } from '../auth/auth.service.ts';
import type { ListEmployeesQuery } from '../employees/employee.schemas.ts';
import type { EmployeesService } from '../employees/employees.service.ts';
import type { ExportRepos } from './exports.repository.ts';

export type ExportFilters = Omit<ListEmployeesQuery, 'page' | 'pageSize'>;

// ponytail: OFFSET batches can skip or repeat a row if employees change mid-export; a
// REPEATABLE READ transaction or keyset paging is the fix if that ever matters.
const BATCH_SIZE = 1000;

export function createExportsService(deps: {
  clock: Clock;
  employees: EmployeesService;
  repos: ExportRepos;
}) {
  return {
    /**
     * Audits the export (before any data is sent, so abandoned downloads are recorded too) and
     * returns the rows in batches, so memory stays flat however many employees match.
     */
    async employees(filters: ExportFilters, format: 'csv' | 'xlsx', actor: AuthUser) {
      const page = (n: number) =>
        deps.employees.list({ ...filters, page: n, pageSize: BATCH_SIZE });
      const first = await page(1);
      await deps.repos.recordExport({
        requestedBy: actor.id,
        format,
        delivery: 'direct',
        filters,
        rowCount: first.total,
        createdAt: deps.clock.now(),
      });

      async function* batches() {
        yield first.items;
        for (let n = 2; (n - 1) * BATCH_SIZE < first.total; n++) yield (await page(n)).items;
      }
      return {
        filename: `employees-${deps.clock.today()}.${format}`,
        currency: first.currency,
        batches: batches(),
      };
    },
  };
}

export type ExportsService = ReturnType<typeof createExportsService>;
