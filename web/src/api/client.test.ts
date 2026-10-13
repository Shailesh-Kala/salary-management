import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './client.ts';

const respond = (status: number, error: object) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ error }), { status })),
  );

afterEach(() => vi.unstubAllGlobals());

describe('api errors', () => {
  it('adds the request reference to an unexpected server error, so it can be found in the logs', async () => {
    respond(500, { code: 'INTERNAL', message: 'Something went wrong', requestId: 'req-123' });

    const error = await api('/exports').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe('Something went wrong (ref req-123)');
  });

  it('leaves the message of expected errors as the server wrote it', async () => {
    respond(410, { code: 'GONE', message: 'This export link has expired.', requestId: 'req-9' });

    await expect(api('/exports/1/download')).rejects.toThrow(/^This export link has expired\.$/);
  });
});
