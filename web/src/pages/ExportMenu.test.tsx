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

function setup(
  path: string,
  exportResponse: (format: string) => Response,
  extraRoutes: Record<string, (url: URL, body: unknown) => Response> = {},
) {
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
    ...extraRoutes,
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

  const tooLarge = () =>
    json(422, {
      error: {
        code: 'EXPORT_TOO_LARGE',
        message: 'A PDF can hold up to 1,000 rows and this list has 10,000.',
        details: { rowCount: 10000, limit: 1000 },
      },
    });

  it('offers to email a PDF that is too large, to your own address', async () => {
    const posted: unknown[] = [];
    setup('/employees?country=IN&currency=USD&sort=annualSalary&order=desc&page=2', tooLarge, {
      'POST /api/exports/employees/email': (_url, body) => {
        posted.push(body);
        return json(202, { exportId: 'x1' });
      },
    });

    await exportAs('PDF');

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(
      'This list has 10,000 employees, but a PDF can hold up to 1,000.',
    );
    expect(dialog).toHaveTextContent('hr@acme.local');
    expect(saved).toEqual([]);

    await user().click(within(dialog).getByRole('button', { name: /email me the pdf/i }));

    expect(await within(dialog).findByText(/we are preparing your pdf/i)).toBeInTheDocument();
    expect(posted).toEqual([
      { country: 'IN', currency: 'USD', sort: 'annualSalary', order: 'desc' },
    ]);
    expect(within(dialog).getByRole('link', { name: /my exports/i })).toHaveAttribute(
      'href',
      '/exports',
    );
  });

  it('sends nothing when you cancel', async () => {
    const posted: unknown[] = [];
    setup('/employees', tooLarge, {
      'POST /api/exports/employees/email': (_url, body) => {
        posted.push(body);
        return json(202, { exportId: 'x1' });
      },
    });
    await exportAs('PDF');

    await user().click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: /cancel/i }),
    );

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(posted).toEqual([]);
  });

  it('shows why queueing failed inside the dialog', async () => {
    setup('/employees', tooLarge, {
      'POST /api/exports/employees/email': () =>
        json(400, {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request',
            details: [{ path: 'country', message: 'Unknown country' }],
          },
        }),
    });
    await exportAs('PDF');
    const dialog = await screen.findByRole('dialog');

    await user().click(within(dialog).getByRole('button', { name: /email me the pdf/i }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Invalid request');
  });
});
