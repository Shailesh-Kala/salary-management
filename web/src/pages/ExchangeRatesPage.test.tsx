import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { USER } from '../test/fixtures.ts';
import { json, mockApi, renderAt } from '../test/render.tsx';

const user = () => userEvent.setup({ delay: null });

const rate = (currencyCode: string, inrPerUnit: string, extra: object = {}) => ({
  currencyCode,
  inrPerUnit,
  asOf: '2026-10-01',
  updatedBy: null,
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...extra,
});

function setup(putResponse?: (body: { inrPerUnit: string; asOf: string }) => Response) {
  const state = {
    rates: [rate('EUR', '103.200000'), rate('INR', '1.000000'), rate('USD', '88.750000')],
    history: [] as object[],
    puts: [] as unknown[],
  };
  mockApi({
    'GET /api/auth/me': () => json(200, { user: USER }),
    'GET /api/exchange-rates': () => json(200, { items: state.rates }),
    'GET /api/exchange-rates/history': () =>
      json(200, { items: state.history, total: state.history.length, page: 1, pageSize: 25 }),
    'PUT /api/exchange-rates/USD': (_url, body) => {
      const input = body as { inrPerUnit: string; asOf: string };
      state.puts.push(input);
      if (putResponse) return putResponse(input);
      const updated = rate('USD', '90.000000', {
        asOf: input.asOf,
        updatedBy: { id: 'u1', name: 'HR Manager' },
      });
      state.rates = state.rates.map((r) => (r.currencyCode === 'USD' ? updated : r));
      state.history = [
        {
          id: '1',
          currencyCode: 'USD',
          oldInrPerUnit: '88.750000',
          newInrPerUnit: '90.000000',
          oldAsOf: '2026-10-01',
          newAsOf: input.asOf,
          changedBy: { id: 'u1', name: 'HR Manager' },
          changedAt: '2026-10-12T09:00:00.000Z',
        },
      ];
      return json(200, updated);
    },
  });
  renderAt('/exchange-rates');
  return state;
}

const row = (currency: string) =>
  screen.getAllByRole('row').find((r) => within(r).queryByText(currency) !== null)!;

describe('exchange rates page', () => {
  it('lists each rate with its date; INR is the fixed base currency', async () => {
    setup();

    expect(await screen.findByRole('heading', { name: 'Exchange rates' })).toBeInTheDocument();
    expect(await screen.findByText('88.75')).toBeInTheDocument();
    expect(within(row('USD')).getByText('2026-10-01')).toBeInTheDocument();
    expect(within(row('INR')).getByText(/base currency/i)).toBeInTheDocument();
    expect(within(row('INR')).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/no rate changes yet/i)).toBeInTheDocument();
  });

  it('saves a new rate, then shows the new rate, its date and the history entry', async () => {
    const state = setup();
    await user().click(await screen.findByRole('button', { name: 'Edit USD rate' }));
    const dialog = await screen.findByRole('dialog');

    const rateInput = within(dialog).getByRole('textbox', { name: /inr per 1 usd/i });
    expect(rateInput).toHaveValue('88.75');
    await user().clear(rateInput);
    await user().type(rateInput, '90');
    const asOf = within(dialog).getByLabelText(/as of/i);
    await user().clear(asOf);
    await user().type(asOf, '2026-10-12');
    await user().click(within(dialog).getByRole('button', { name: /save/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(state.puts).toEqual([{ inrPerUnit: '90', asOf: '2026-10-12' }]);
    expect(await within(row('USD')).findByText('90')).toBeInTheDocument();
    expect(within(row('USD')).getByText('2026-10-12')).toBeInTheDocument();
    const history = await screen.findByRole('table', { name: /rate history/i });
    expect(history).toHaveTextContent('88.75 → 90');
    expect(history).toHaveTextContent('2026-10-01 → 2026-10-12');
    expect(history).toHaveTextContent('HR Manager');
  });

  it('shows a server validation error in the dialog', async () => {
    setup(() =>
      json(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          details: [{ path: 'asOf', message: 'Rate date cannot be in the future' }],
        },
      }),
    );
    await user().click(await screen.findByRole('button', { name: 'Edit USD rate' }));
    const dialog = await screen.findByRole('dialog');

    await user().click(within(dialog).getByRole('button', { name: /save/i }));

    expect(
      await within(dialog).findByText('Rate date cannot be in the future'),
    ).toBeInTheDocument();
  });

  it('is reachable from the app bar', async () => {
    setup();
    await screen.findByText('88.75');

    await user().click(screen.getByRole('link', { name: 'Employees' }));

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/employees'));
  });
});
