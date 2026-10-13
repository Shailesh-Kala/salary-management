import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { USER } from '../test/fixtures.ts';
import { json, mockApi, renderAt } from '../test/render.tsx';

const ID = '6f1c1d2e-0000-4000-8000-0000000000e1';
const PATH = `/exports/${ID}`;

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

const pdf = () =>
  new Response('%PDF-', {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="employees-2026-10-12.pdf"',
    },
  });
const refused = (status: number, code: string, message: string) =>
  json(status, { error: { code, message } });

describe('export download page (the page the email links to)', () => {
  it('fetches the file with the session cookie and saves it', async () => {
    const fetchMock = mockApi({
      'GET /api/auth/me': () => json(200, { user: USER }),
      [`GET /api/exports/${ID}/download`]: pdf,
    });
    renderAt(PATH);

    expect(await screen.findByText(/your export has been saved/i)).toBeInTheDocument();
    expect(saved).toEqual([{ href: 'blob:export', download: 'employees-2026-10-12.pdf' }]);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/exports/${ID}/download`,
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('asks you to sign in first, then comes back and downloads', async () => {
    let signedIn = false;
    mockApi({
      'GET /api/auth/me': () =>
        signedIn
          ? json(200, { user: USER })
          : json(401, { error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }),
      'POST /api/auth/login': () => {
        signedIn = true;
        return json(200, { user: USER });
      },
      [`GET /api/exports/${ID}/download`]: pdf,
    });
    renderAt(PATH);
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        `/login?next=${encodeURIComponent(PATH)}`,
      ),
    );
    expect(saved).toEqual([]);

    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByLabelText(/email/i), 'hr@acme.local');
    await user.type(screen.getByLabelText(/password/i), 'secret');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(PATH));
    expect(await screen.findByText(/your export has been saved/i)).toBeInTheDocument();
    expect(saved).toHaveLength(1);
  });

  it('tells someone else that only the requester can download it (403)', async () => {
    mockApi({
      'GET /api/auth/me': () => json(200, { user: USER }),
      [`GET /api/exports/${ID}/download`]: () =>
        refused(403, 'FORBIDDEN', 'Only the person who requested this export can download it'),
    });
    renderAt(PATH);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only the person who requested this export can download it',
    );
    expect(saved).toEqual([]);
    expect(screen.getByRole('link', { name: /my exports/i })).toHaveAttribute('href', '/exports');
  });

  it('tells you an expired link needs a new export (410)', async () => {
    mockApi({
      'GET /api/auth/me': () => json(200, { user: USER }),
      [`GET /api/exports/${ID}/download`]: () =>
        refused(410, 'GONE', 'This export link has expired. Request the export again.'),
    });
    renderAt(PATH);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This export link has expired. Request the export again.',
    );
    expect(saved).toEqual([]);
  });

  it('can download again from the page', async () => {
    mockApi({
      'GET /api/auth/me': () => json(200, { user: USER }),
      [`GET /api/exports/${ID}/download`]: pdf,
    });
    renderAt(PATH);
    await screen.findByText(/your export has been saved/i);

    await userEvent
      .setup({ delay: null })
      .click(screen.getByRole('button', { name: /download again/i }));

    await waitFor(() => expect(saved).toHaveLength(2));
  });
});
