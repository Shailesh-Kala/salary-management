import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { employeeDetail, FILTER_OPTIONS, historyEntry, USER } from '../test/fixtures.ts';
import { json, mockApi, renderAt } from '../test/render.tsx';

const user = () => userEvent.setup({ delay: null });

const PROMOTION_ENTRY = historyEntry({
  id: '2',
  changeType: 'promotion',
  effectiveDate: '2026-10-01',
  note: 'Led the payments migration',
  changes: {
    baseSalary: { old: '1800000.00', new: '2400000' },
    jobTitle: { old: 'Software Engineer', new: 'Senior Software Engineer' },
  },
});

function setup(
  postResponse: () => Response = () =>
    json(201, {
      employee: employeeDetail({ jobTitle: 'Senior Software Engineer', version: 2 }),
      change: PROMOTION_ENTRY,
    }),
) {
  const calls = { history: 0, posts: [] as Record<string, unknown>[] };
  mockApi({
    'GET /api/auth/me': () => json(200, { user: USER }),
    'GET /api/employees/filter-options': () => json(200, FILTER_OPTIONS),
    'GET /api/employees/e1': () => json(200, employeeDetail()),
    'GET /api/employees/e1/changes': () => {
      calls.history++;
      return json(200, {
        items: calls.history === 1 ? [historyEntry()] : [PROMOTION_ENTRY, historyEntry()],
      });
    },
    'POST /api/employees/e1/changes': (_url, body) => {
      calls.posts.push(body as Record<string, unknown>);
      return postResponse();
    },
  });
  renderAt('/employees/e1');
  return calls;
}

async function openDialog() {
  await user().click(await screen.findByRole('button', { name: /record change/i }));
  return screen.findByRole('dialog');
}

async function choose(dialog: HTMLElement, label: RegExp, option: string) {
  await user().click(within(dialog).getByRole('combobox', { name: label }));
  await user().click(
    within(await screen.findByRole('listbox')).getByRole('option', { name: option }),
  );
}

const textbox = (dialog: HTMLElement, name: RegExp) =>
  within(dialog).getByRole('textbox', { name });

async function replace(input: HTMLElement, value: string) {
  await user().clear(input);
  await user().type(input, value);
}

describe('employee history', () => {
  it('shows each change with its note, old → new values and author, newest first', async () => {
    mockApi({
      'GET /api/auth/me': () => json(200, { user: USER }),
      'GET /api/employees/filter-options': () => json(200, FILTER_OPTIONS),
      'GET /api/employees/e1': () => json(200, employeeDetail()),
      'GET /api/employees/e1/changes': () =>
        json(200, { items: [PROMOTION_ENTRY, historyEntry()] }),
    });
    renderAt('/employees/e1');

    const history = await screen.findByRole('list', { name: /history/i });
    const entries = within(history).getAllByRole('listitem');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent('Promotion');
    expect(entries[0]).toHaveTextContent('2026-10-01');
    expect(entries[0]).toHaveTextContent('Led the payments migration');
    expect(entries[0]).toHaveTextContent('Base salary: ₹18,00,000.00 → ₹24,00,000.00');
    expect(entries[0]).toHaveTextContent('Job title: Software Engineer → Senior Software Engineer');
    expect(entries[0]).toHaveTextContent('HR Manager');
    expect(entries[1]).toHaveTextContent('Hired');
    expect(entries[1]).toHaveTextContent('Base salary: ₹18,00,000.00');
  });
});

describe('record change dialog', () => {
  it('keeps Save disabled until the note is at least 5 characters', async () => {
    setup();
    const dialog = await openDialog();

    await choose(dialog, /change type/i, 'Annual review');
    await user().type(within(dialog).getByLabelText(/effective date/i), '2026-10-01');
    await replace(textbox(dialog, /base salary/i), '2000000');
    await user().type(textbox(dialog, /note/i), 'ok');
    const save = within(dialog).getByRole('button', { name: /save/i });
    expect(save).toBeDisabled();

    await user().type(textbox(dialog, /note/i), ' year');
    expect(save).toBeEnabled();
  });

  it('records a promotion with the loaded version and refreshes history', async () => {
    const calls = setup();
    const dialog = await openDialog();

    await choose(dialog, /change type/i, 'Promotion');
    await user().type(within(dialog).getByLabelText(/effective date/i), '2026-10-01');
    await replace(textbox(dialog, /job title/i), 'Senior Software Engineer');
    await replace(textbox(dialog, /base salary/i), '2400000');
    await user().type(textbox(dialog, /note/i), 'Led the payments migration');
    await user().click(within(dialog).getByRole('button', { name: /save/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calls.posts).toHaveLength(1);
    expect(calls.posts[0]).toMatchObject({
      version: 1,
      changeType: 'promotion',
      effectiveDate: '2026-10-01',
      note: 'Led the payments migration',
      jobTitle: 'Senior Software Engineer',
      baseSalary: '2400000',
    });
    expect(calls.posts[0]).not.toHaveProperty('countryCode');
    expect(calls.posts[0]).not.toHaveProperty('hireDate');
    await waitFor(() => expect(calls.history).toBe(2));
    expect(await screen.findByText('Senior Software Engineer')).toBeInTheDocument();
  });

  it('for a relocation, asks for the new country and new pay in its currency', async () => {
    const calls = setup();
    const dialog = await openDialog();

    await choose(dialog, /change type/i, 'Relocation');
    await user().type(within(dialog).getByLabelText(/effective date/i), '2026-09-01');
    await user().type(textbox(dialog, /note/i), 'Moved to the New York office');
    expect(textbox(dialog, /base salary/i)).toHaveValue('');

    await choose(dialog, /new country/i, 'United States');
    expect(textbox(dialog, /base salary \(USD\)/i)).toBeInTheDocument();
    const save = within(dialog).getByRole('button', { name: /save/i });
    expect(save).toBeDisabled();

    await user().type(textbox(dialog, /base salary/i), '150000');
    expect(save).toBeDisabled();
    await user().type(textbox(dialog, /allowances/i), '10000');
    await user().click(save);

    await waitFor(() => expect(calls.posts).toHaveLength(1));
    expect(calls.posts[0]).toMatchObject({
      changeType: 'relocation',
      countryCode: 'US',
      baseSalary: '150000',
      allowances: '10000',
    });
  });

  it('shows a server validation error on its field and keeps the dialog open', async () => {
    setup(() =>
      json(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          details: [
            {
              path: 'effectiveDate',
              message: 'Effective date must be on or after 2024-04-01 (the latest change)',
            },
          ],
        },
      }),
    );
    const dialog = await openDialog();

    await choose(dialog, /change type/i, 'Annual review');
    await user().type(within(dialog).getByLabelText(/effective date/i), '2024-03-01');
    await replace(textbox(dialog, /base salary/i), '2000000');
    await user().type(textbox(dialog, /note/i), 'Back-dated raise');
    await user().click(within(dialog).getByRole('button', { name: /save/i }));

    expect(
      await within(dialog).findByText(
        'Effective date must be on or after 2024-04-01 (the latest change)',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
