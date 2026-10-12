import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { employeeDetail, USER } from '../test/fixtures.ts';
import { json, mockApi, renderAt } from '../test/render.tsx';

const user = () => userEvent.setup();

function setup(
  patchResponse: () => Response = () =>
    json(200, employeeDetail({ lastName: 'Sharma', version: 2 })),
) {
  const calls = { get: 0, patches: [] as unknown[] };
  mockApi({
    'GET /api/auth/me': () => json(200, { user: USER }),
    'GET /api/employees/e1': () => {
      calls.get++;
      return json(200, employeeDetail());
    },
    'GET /api/employees/missing': () =>
      json(404, { error: { code: 'NOT_FOUND', message: 'Employee not found' } }),
    'PATCH /api/employees/e1': (_url, body) => {
      calls.patches.push(body);
      return patchResponse();
    },
  });
  return calls;
}

describe('employee detail page', () => {
  it('shows the profile and current pay in local currency', async () => {
    setup();
    renderAt('/employees/e1');

    expect(await screen.findByRole('heading', { name: 'Asha Verma' })).toBeInTheDocument();
    expect(screen.getByText('EMP-00001')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('India')).toBeInTheDocument();
    expect(screen.getByText('₹18,00,000.00')).toBeInTheDocument(); // base
    expect(screen.getByText('₹2,00,000.00')).toBeInTheDocument(); // allowances
    expect(screen.getByText('₹20,00,000.00')).toBeInTheDocument(); // annual total
  });

  it('edits the profile, sending the version it was loaded with', async () => {
    const calls = setup();
    renderAt('/employees/e1');

    await user().click(await screen.findByRole('button', { name: /edit profile/i }));
    const dialog = await screen.findByRole('dialog');
    const lastName = within(dialog).getByRole('textbox', { name: /last name/i });
    await user().clear(lastName);
    await user().type(lastName, 'Sharma');
    await user().click(within(dialog).getByRole('button', { name: /save/i }));

    expect(await screen.findByRole('heading', { name: 'Asha Sharma' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calls.patches).toEqual([
      { version: 1, firstName: 'Asha', lastName: 'Sharma', email: 'asha.verma@acme.com' },
    ]);
  });

  it('explains a version conflict and reloads the latest details on request', async () => {
    const calls = setup(() =>
      json(409, { error: { code: 'VERSION_CONFLICT', message: 'Changed by someone else' } }),
    );
    renderAt('/employees/e1');

    await user().click(await screen.findByRole('button', { name: /edit profile/i }));
    await user().click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: /save/i }),
    );

    expect(await screen.findByText(/someone else updated this employee/i)).toBeInTheDocument();
    await user().click(screen.getByRole('button', { name: /reload/i }));
    await waitFor(() => expect(calls.get).toBe(2));
  });

  it('says so when the employee does not exist', async () => {
    setup();
    renderAt('/employees/missing');

    expect(await screen.findByText('Employee not found')).toBeInTheDocument();
  });
});
