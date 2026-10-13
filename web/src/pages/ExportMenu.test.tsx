import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FILTER_OPTIONS, USER } from '../test/fixtures.ts';
import { json, mockApi, renderAt } from '../test/render.tsx';

const user = () => userEvent.setup({ delay: null });

const file = (body: string, filename: string, type: string) =>
  new Response(body, {
    status: 200,
    headers: { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${filename}"` },
  });

let saved: { href: string; download: string }[];

beforeEach(() => {
  saved = [];
  // jsdom has no object URLs or downloads: record what would have been saved instead.
  URL.createObjectURL = vi.fn(() => 'blob:export');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push({ href: this.href, download: this.download });
  });
});

function setup(path: string, exportResponse: (format: string) => Response) {
  const exports: Record<string, string>[] = [];
  mockApi({
    'GET /api/auth/me': () => json(200, { user: USER }),
    'GET /api/employees/filter-options': () => json(200, FILTER_OPTIONS),
    'GET /api/employees': () =>
      json(200, {
        items: [],
        total: 0,
        page: 1,
        pageSize: 25,
        currency: 'USD',
        ratesAsOf: '2026-10-01',
      }),
    'GET /api/exports/employees': (url) => {
      const query = Object.fromEntries(url.searchParams);
      exports.push(query);
      return exportResponse(query.format!);
    },
  });
  renderAt(path);
  return exports;
}

async function exportAs(format: string) {
  await user().click(await screen.findByRole('button', { name: /export/i }));
  await user().click(
    within(await screen.findByRole('menu')).getByRole('menuitem', { name: format }),
  );
}

describe('export menu on the employees list', () => {
  it.each([
    ['CSV', 'csv', 'employees-2026-10-12.csv', 'text/csv'],
    [
      'Excel',
      'xlsx',
      'employees-2026-10-12.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    ['PDF', 'pdf', 'employees-2026-10-12.pdf', 'application/pdf'],
  ])(
    'downloads %s for the current filters, sort and currency',
    async (label, format, filename, type) => {
      const exports = setup(
        '/employees?country=IN&status=active&q=asha&sort=annualSalary&order=desc&currency=USD&page=3',
        () => file('data', filename, type),
      );

      await exportAs(label);

      await waitFor(() => expect(saved).toEqual([{ href: 'blob:export', download: filename }]));
      expect(exports).toEqual([
        {
          format,
          country: 'IN',
          status: 'active',
          q: 'asha',
          sort: 'annualSalary',
          order: 'desc',
          currency: 'USD',
        },
      ]);
    },
  );

  it('explains when a PDF would be too large, and offers CSV or Excel instead', async () => {
    setup('/employees', () =>
      json(422, {
        error: {
          code: 'EXPORT_TOO_LARGE',
          message: 'A PDF can hold up to 1,000 rows and this list has 10,000.',
          details: { rowCount: 10000, limit: 1000 },
        },
      }),
    );

    await exportAs('PDF');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This list has 10,000 employees, but a PDF can hold up to 1,000. Narrow the filters, or download CSV or Excel.',
    );
    expect(saved).toEqual([]);
  });
});
