import type { Clock } from '../../lib/clock.ts';
import { lastDayOfMonth } from '../../lib/dates.ts';
import { AppError } from '../../lib/errors.ts';
import { renderSlipPdf } from './slip-pdf.ts';
import { buildSlip } from './slip.ts';
import type { SlipRepos } from './slips.repository.ts';

export function createSlipsService({ clock, repos }: { clock: Clock; repos: SlipRepos }) {
  const service = {
    async get(employeeId: string, month: string) {
      const employee = await repos.findEmployee(employeeId);
      if (!employee) throw new AppError('NOT_FOUND', 404, 'Employee not found');
      const snapshot = await repos.snapshotAt(employeeId, lastDayOfMonth(month));
      // Every employee gets a history entry when created, so this only fails on corrupt data.
      if (!snapshot) throw new Error(`Employee ${employeeId} has no pay history`);
      return buildSlip({ employee, snapshot, month, today: clock.today() });
    },

    /** The same slip as a PDF; validation errors are thrown before anything is rendered. */
    async pdf(employeeId: string, month: string) {
      const slip = await service.get(employeeId, month);
      return {
        filename: `slip-${slip.employee.employeeCode}-${month}.pdf`,
        content: await renderSlipPdf(slip, clock.now()),
      };
    },
  };
  return service;
}

export type SlipsService = ReturnType<typeof createSlipsService>;
