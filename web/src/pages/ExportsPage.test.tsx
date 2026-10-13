import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { USER } from '../test/fixtures.ts';
import { json, mockApi, renderAt } from '../test/render.tsx';

const item = (id: string, overrides: object = {}) => ({
  id,
  status: 'ready',
  rowCount: 10000,
  createdAt: '2026-10-12T09:00:00.000Z',
  expiresAt: '2099-01-01T09:00:00.000Z',
  deletedAt: null,
  error: null,
  ...overrides,
});

function setup(items: object[]) {
  mockApi({
    'GET /api/auth/me': () => json(200, { user: USER }),
    'GET /api/exports': () => json(200, { items }),
  });
  renderAt('/exports');
}

const row = (text: string) =>
  screen.getAllByRole('row').find((r) => within(r).queryByText(text) !== null)!;

describe('my exports page', () => {
  it('shows each emailed export with its state and a link only while it can be opened', async () => {
    setup([
      item('q1', { status: 'queued', expiresAt: null, rowCount: 111 }),
      item('r1', { rowCount: 222 }),
      item('d1', { deletedAt: '2026-10-13T09:00:00.000Z', rowCount: 333 }),
      item('f1', {
        status: 'failed',
        expiresAt: null,
        error: 'SMTP server unavailable',
        rowCount: 444,
      }),
    ]);

    await screen.findByRole('table', { name: /my exports/i });
    expect(within(row('111')).getByText(/being prepared/i)).toBeInTheDocument();
    expect(within(row('111')).queryByRole('link')).not.toBeInTheDocument();
    expect(within(row('222')).getByText('Ready')).toBeInTheDocument();
    expect(within(row('222')).getByRole('link', { name: /open/i })).toHaveAttribute(
      'href',
      '/exports/r1',
    );
    expect(within(row('333')).getByText('Expired')).toBeInTheDocument();
    expect(within(row('333')).queryByRole('link')).not.toBeInTheDocument();
    expect(within(row('444')).getByText('Failed')).toBeInTheDocument();
    expect(within(row('444')).getByText(/SMTP server unavailable/)).toBeInTheDocument();
  });

  it('says so when there are none', async () => {
    setup([]);

    expect(await screen.findByText(/no emailed exports yet/i)).toBeInTheDocument();
  });
});
