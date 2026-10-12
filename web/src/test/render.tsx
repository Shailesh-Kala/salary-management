import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { vi } from 'vitest';
import { createQueryClient } from '../api/query-client.ts';
import { AppRoutes } from '../App.tsx';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

/** Renders the real routes at `path`; the current URL is readable from the "location" test id. */
export function renderAt(path: string) {
  const client = createQueryClient({ retry: false });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

export const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * Stubs fetch with handlers keyed by "METHOD /path" (query string ignored); each handler gets
 * the full URL. Any other request fails the test.
 */
export function mockApi(routes: Record<string, (url: URL) => Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const key = `${init?.method ?? 'GET'} ${url.pathname}`;
    const handler = routes[key];
    if (!handler) throw new Error(`Unexpected request: ${key}`);
    return handler(url);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
