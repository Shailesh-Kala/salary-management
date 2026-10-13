import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { USER } from '../test/fixtures.ts';
import { json, mockApi, renderAt } from '../test/render.tsx';

const user = () => userEvent.setup({ delay: null });

const ID = '6f1c1d2e-0000-4000-8000-000000000001';

const importDetails = (overrides: object = {}) => ({
  id: ID,
  status: 'awaiting_confirmation',
  fileName: 'october.csv',
  changeType: 'annual_review',
  effectiveDate: '2026-10-01',
  note: 'FY26 annual review',
  rowCount: 4,
  counts: { total: 4, valid: 3, toCreate: 1, toUpdate: 1, unchanged: 1, rejected: 1 },
  previewExpiresAt: '2026-10-13T09:00:00.000Z',
  error: null,
  createdAt: '2026-10-12T09:00:00.000Z',
  finishedAt: null,
  uploadedBy: { id: 'u1', name: 'HR Manager' },
  rejected: [
    {
      rowNumber: 4,
      employeeCode: 'EXAMPLE-1',
      errors: ['Example row: replace it with a real employee or delete it'],
    },
  ],
  ...overrides,
});

function setupImport(details: object, extra: Record<string, () => Response> = {}) {
  const calls: string[] = [];
  let current = details;
  mockApi({
    'GET /api/auth/me': () => json(200, { user: USER }),
    [`GET /api/imports/${ID}`]: () => json(200, current),
    [`POST /api/imports/${ID}/confirm`]: () => {
      calls.push('confirm');
      current = { ...current, status: 'applying' };
      return json(202, current);
    },
    [`POST /api/imports/${ID}/cancel`]: () => {
      calls.push('cancel');
      current = { ...current, status: 'cancelled' };
      return json(200, current);
    },
    ...extra,
  });
  renderAt(`/imports/${ID}`);
  return calls;
}

describe('import page', () => {
  it('shows the preview counts, the deadline and the rejected rows', async () => {
    setupImport(importDetails());

    expect(await screen.findByRole('heading', { name: 'october.csv' })).toBeInTheDocument();
    const counts = screen.getByRole('list', { name: /preview/i });
    expect(counts).toHaveTextContent('4 rows');
    expect(counts).toHaveTextContent('1 to create');
    expect(counts).toHaveTextContent('1 to update');
    expect(counts).toHaveTextContent('1 unchanged');
    expect(counts).toHaveTextContent('1 rejected');
    expect(screen.getByText(/confirm or cancel by/i)).toBeInTheDocument();
    const rejected = screen.getByRole('table', { name: /rejected rows/i });
    expect(rejected).toHaveTextContent('EXAMPLE-1');
    expect(rejected).toHaveTextContent('Example row: replace it with a real employee or delete it');
    expect(screen.getByRole('button', { name: /download rejected rows/i })).toBeInTheDocument();
  });

  it('imports the valid rows with "Import valid rows"', async () => {
    const calls = setupImport(importDetails());

    await user().click(await screen.findByRole('button', { name: /import 3 valid rows/i }));

    await waitFor(() => expect(calls).toEqual(['confirm']));
    expect(await screen.findByText(/importing/i)).toBeInTheDocument();
  });

  it('cancels the import with "Cancel import"', async () => {
    const calls = setupImport(importDetails());

    await user().click(await screen.findByRole('button', { name: /cancel import/i }));

    await waitFor(() => expect(calls).toEqual(['cancel']));
    expect(await screen.findByText(/cancelled\. nothing was changed/i)).toBeInTheDocument();
  });

  it('says an expired preview must be uploaded again', async () => {
    setupImport(importDetails({ status: 'expired', rejected: [] }));

    expect(await screen.findByText(/preview expired — upload again/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /upload again/i })).toHaveAttribute('href', '/imports');
    expect(screen.queryByRole('button', { name: /import .* valid rows/i })).not.toBeInTheDocument();
  });

  it('shows the 410 message when the preview expires before confirming', async () => {
    setupImport(importDetails(), {
      [`POST /api/imports/${ID}/confirm`]: () =>
        json(410, {
          error: {
            code: 'GONE',
            message:
              'This preview expired at 2026-10-13T09:00:00.000Z. Upload the file again to import it.',
          },
        }),
    });

    await user().click(await screen.findByRole('button', { name: /import 3 valid rows/i }));

    expect(await screen.findByText(/upload the file again to import it/i)).toBeInTheDocument();
  });

  it('shows the final report once the import has completed', async () => {
    setupImport(
      importDetails({
        status: 'completed',
        finishedAt: '2026-10-12T09:05:00.000Z',
        counts: {
          total: 4,
          valid: 3,
          toCreate: 1,
          toUpdate: 1,
          unchanged: 1,
          rejected: 1,
          created: 1,
          updated: 1,
        },
      }),
    );

    const report = await screen.findByRole('list', { name: /result/i });
    expect(report).toHaveTextContent('1 created');
    expect(report).toHaveTextContent('1 updated');
    expect(report).toHaveTextContent('1 unchanged');
    expect(report).toHaveTextContent('1 rejected');
    expect(
      screen.queryByRole('button', { name: /download rejected rows/i }),
    ).not.toBeInTheDocument();
  });
});

describe('imports page', () => {
  const history = {
    items: [
      {
        id: ID,
        status: 'completed',
        fileName: 'october.csv',
        changeType: 'annual_review',
        effectiveDate: '2026-10-01',
        rowCount: 4,
        counts: null,
        createdAt: '2026-10-12T09:00:00.000Z',
        finishedAt: '2026-10-12T09:05:00.000Z',
        uploadedBy: { id: 'u1', name: 'HR Manager' },
      },
    ],
    total: 1,
    page: 1,
    pageSize: 25,
  };

  function setupUpload(response: () => Response) {
    const uploads: FormData[] = [];
    mockApi({
      'GET /api/auth/me': () => json(200, { user: USER }),
      'GET /api/imports': () => json(200, history),
      'POST /api/imports': (_url, body) => {
        uploads.push(body as FormData);
        return response();
      },
      [`GET /api/imports/${ID}`]: () =>
        json(200, importDetails({ status: 'validating', counts: null, rejected: [] })),
    });
    renderAt('/imports');
    return uploads;
  }

  async function fillAndUpload() {
    const file = new File(['employee_code\nEMP-1'], 'october.csv', { type: 'text/csv' });
    await user().upload(await screen.findByLabelText(/csv file/i), file);
    await user().click(screen.getByRole('combobox', { name: /change type/i }));
    await user().click(await screen.findByRole('option', { name: 'Promotion' }));
    await user().type(screen.getByLabelText(/effective date/i), '2026-10-01');
    await user().type(screen.getByRole('textbox', { name: /note/i }), 'October promotions');
    await user().click(screen.getByRole('button', { name: /^upload$/i }));
  }

  it('lists past imports with a link to each', async () => {
    setupUpload(() => json(202, {}));

    const table = await screen.findByRole('table', { name: /import history/i });
    expect(within(table).getByRole('link', { name: 'october.csv' })).toHaveAttribute(
      'href',
      `/imports/${ID}`,
    );
    expect(table).toHaveTextContent('Completed');
    expect(table).toHaveTextContent('HR Manager');
    expect(screen.getByRole('button', { name: /download template/i })).toBeInTheDocument();
  });

  it('uploads the file with the form and opens the import', async () => {
    const uploads = setupUpload(() => json(202, { id: ID, status: 'validating', rowCount: 1 }));

    await fillAndUpload();

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/imports/${ID}`));
    const sent = uploads[0]!;
    expect((sent.get('file') as File).name).toBe('october.csv');
    expect(sent.get('changeType')).toBe('promotion');
    expect(sent.get('effectiveDate')).toBe('2026-10-01');
    expect(sent.get('note')).toBe('October promotions');
  });

  it('links to the import in progress when another one is running', async () => {
    setupUpload(() =>
      json(409, {
        error: {
          code: 'IMPORT_IN_PROGRESS',
          message:
            'Another import is in progress. Finish or cancel it before uploading a new file.',
          details: { importId: ID },
        },
      }),
    );

    await fillAndUpload();

    expect(await screen.findByText(/another import is in progress/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open the import in progress/i })).toHaveAttribute(
      'href',
      `/imports/${ID}`,
    );
  });

  it('is reachable from the app bar', async () => {
    setupUpload(() => json(202, {}));
    await screen.findByRole('table', { name: /import history/i });

    await user().click(screen.getByRole('link', { name: 'Employees' }));
    await user().click(screen.getByRole('link', { name: 'Imports' }));

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/imports'));
  });
});
