import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { json, mockApi, renderAt } from './test/render.tsx';

const USER = { id: 'u1', email: 'hr@acme.local', name: 'HR Manager' };

const location = () => screen.getByTestId('location');

async function signIn() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/email/i), 'hr@acme.local');
  await user.type(screen.getByLabelText(/password/i), 'secret');
  await user.click(screen.getByRole('button', { name: /sign in/i }));
}

describe('login page', () => {
  it('signs in with credentials included and goes to /employees by default', async () => {
    const fetchMock = mockApi({ 'POST /api/auth/login': () => json(200, { user: USER }) });
    renderAt('/login');

    await signIn();

    await waitFor(() => expect(location()).toHaveTextContent(/^\/employees$/));
    expect(await screen.findByText('HR Manager')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ email: 'hr@acme.local', password: 'secret' }),
      }),
    );
  });

  it('returns to the page in ?next= after signing in', async () => {
    mockApi({ 'POST /api/auth/login': () => json(200, { user: USER }) });
    renderAt(`/login?next=${encodeURIComponent('/employees?country=IN')}`);

    await signIn();

    await waitFor(() => expect(location()).toHaveTextContent('/employees?country=IN'));
  });

  it.each(['https://evil.example/phish', '//evil.example', '/\\evil.example'])(
    'ignores an unsafe ?next= (%s) and goes to /employees',
    async (next) => {
      mockApi({ 'POST /api/auth/login': () => json(200, { user: USER }) });
      renderAt(`/login?next=${encodeURIComponent(next)}`);

      await signIn();

      await waitFor(() => expect(location()).toHaveTextContent(/^\/employees$/));
    },
  );

  it('shows the generic error from a 401 and stays on the login page', async () => {
    mockApi({
      'POST /api/auth/login': () =>
        json(401, {
          error: { code: 'UNAUTHENTICATED', message: 'Invalid email or password', requestId: 'r1' },
        }),
    });
    renderAt('/login');

    await signIn();

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(location()).toHaveTextContent(/^\/login$/);
  });
});

describe('protected routes', () => {
  it('redirects to /login with the original URL in ?next= when there is no session', async () => {
    mockApi({
      'GET /api/auth/me': () =>
        json(401, { error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }),
    });
    renderAt('/employees?country=IN');

    await waitFor(() =>
      expect(location()).toHaveTextContent(
        `/login?next=${encodeURIComponent('/employees?country=IN')}`,
      ),
    );
  });

  it('shows the page and the signed-in user when the session is valid', async () => {
    mockApi({ 'GET /api/auth/me': () => json(200, { user: USER }) });
    renderAt('/employees');

    expect(await screen.findByText('HR Manager')).toBeInTheDocument();
    expect(location()).toHaveTextContent(/^\/employees$/);
  });

  it('signs out and returns to the login page', async () => {
    const fetchMock = mockApi({
      'GET /api/auth/me': () => json(200, { user: USER }),
      'POST /api/auth/logout': () => json(204),
    });
    renderAt('/employees');

    await userEvent.setup().click(await screen.findByRole('button', { name: /sign out/i }));

    await waitFor(() => expect(location()).toHaveTextContent(/^\/login$/));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
