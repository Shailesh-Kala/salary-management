import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { employeeDetail, FILTER_OPTIONS, historyEntry, USER } from '../test/fixtures.ts';
import { json, mockApi, renderAt } from '../test/render.tsx';

const user = () => userEvent.setup({ delay: null });

const ON_NOTICE = {
  status: 'on_notice',
  exitType: 'resigned',
  noticeDate: '2026-10-01',
  lastWorkingDay: '2026-11-30',
};

function setup(employee: object, postResponses: Record<string, object> = {}) {
  const posts: { path: string; body: unknown }[] = [];
  const respond = (path: string) => (_url: URL, body: unknown) => {
    posts.push({ path, body });
    return json(201, { employee: employeeDetail(postResponses[path]), change: historyEntry() });
  };
  mockApi({
    'GET /api/auth/me': () => json(200, { user: USER }),
    'GET /api/employees/filter-options': () => json(200, FILTER_OPTIONS),
    'GET /api/employees/e1': () => json(200, employeeDetail(employee)),
    'GET /api/employees/e1/changes': () => json(200, { items: [historyEntry()] }),
    'POST /api/employees/e1/exit': respond('/exit'),
    'POST /api/employees/e1/exit/withdraw': respond('/exit/withdraw'),
  });
  renderAt('/employees/e1');
  return posts;
}

describe('exit details on the employee page', () => {
  it('shows exit type, dates and notice period for an employee on notice', async () => {
    setup(ON_NOTICE);

    expect(await screen.findByText('Resigned')).toBeInTheDocument();
    expect(screen.getByText('2026-10-01')).toBeInTheDocument();
    expect(screen.getByText('2026-11-30')).toBeInTheDocument();
    expect(screen.getByText('60 days')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /withdraw exit/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /record exit/i })).not.toBeInTheDocument();
  });

  it('offers neither exit action once the employee has left', async () => {
    setup({
      ...ON_NOTICE,
      status: 'exited',
      lastWorkingDay: '2026-09-30',
      noticeDate: '2026-08-01',
    });

    await screen.findByText('Resigned');
    expect(screen.queryByRole('button', { name: /record exit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /withdraw exit/i })).not.toBeInTheDocument();
  });
});

describe('record exit dialog', () => {
  it('shows the notice period, blocks out-of-order dates and posts the exit', async () => {
    const posts = setup({}, { '/exit': ON_NOTICE });
    await user().click(await screen.findByRole('button', { name: /record exit/i }));
    const dialog = await screen.findByRole('dialog');

    await user().click(within(dialog).getByRole('combobox', { name: /exit type/i }));
    await user().click(
      within(await screen.findByRole('listbox')).getByRole('option', { name: 'Resigned' }),
    );
    await user().type(within(dialog).getByLabelText(/notice date/i), '2026-10-01');
    const lastDay = within(dialog).getByLabelText(/last working day/i);
    await user().type(lastDay, '2026-09-30');
    await user().type(
      within(dialog).getByRole('textbox', { name: /note/i }),
      'Moving abroad; accepted',
    );

    expect(
      within(dialog).getByText('Last working day must be on or after the notice date'),
    ).toBeInTheDocument();
    const save = within(dialog).getByRole('button', { name: /save/i });
    expect(save).toBeDisabled();

    await user().clear(lastDay);
    await user().type(lastDay, '2026-11-30');
    expect(within(dialog).getByText('Notice period: 60 days')).toBeInTheDocument();
    await user().click(save);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(posts).toEqual([
      {
        path: '/exit',
        body: {
          version: 1,
          exitType: 'resigned',
          noticeDate: '2026-10-01',
          lastWorkingDay: '2026-11-30',
          note: 'Moving abroad; accepted',
        },
      },
    ]);
    expect(await screen.findByText('On notice')).toBeInTheDocument();
  });
});

describe('withdraw exit dialog', () => {
  it('withdraws the exit with a note and shows the employee as active', async () => {
    const posts = setup(ON_NOTICE, { '/exit/withdraw': {} });
    await user().click(await screen.findByRole('button', { name: /withdraw exit/i }));
    const dialog = await screen.findByRole('dialog');

    const confirm = within(dialog).getByRole('button', { name: /withdraw/i });
    expect(confirm).toBeDisabled();
    await user().type(
      within(dialog).getByRole('textbox', { name: /note/i }),
      'Stayed after counter-offer',
    );
    await user().click(confirm);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(posts).toEqual([
      { path: '/exit/withdraw', body: { version: 1, note: 'Stayed after counter-offer' } },
    ]);
    expect(await screen.findByText('Active')).toBeInTheDocument();
  });
});
