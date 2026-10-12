import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Pool } from 'pg';
import { buildTestApp } from '../test/app.ts';

const fakeDb = (query: () => Promise<unknown>) => ({ query }) as unknown as Pool;
const app = buildTestApp({ db: fakeDb(async () => ({ rows: [] })) });

describe('GET /health', () => {
  it('returns ok and echoes the incoming request id', async () => {
    const res = await request(app).get('/health').set('X-Request-Id', 'req-123');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'ok' });
    expect(res.headers['x-request-id']).toBe('req-123');
  });

  it('returns 503 when the database check fails', async () => {
    const downApp = buildTestApp({
      db: fakeDb(async () => {
        throw new Error('connection refused');
      }),
    });

    const res = await request(downApp).get('/health');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error', db: 'down' });
  });

  it('generates a request id when none is sent', async () => {
    const res = await request(app).get('/health');

    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('replaces an unsafe incoming request id instead of echoing it', async () => {
    const res = await request(app).get('/health').set('X-Request-Id', 'bad id;with spaces');

    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('unknown route', () => {
  it('returns 404 in the standard error shape without the query string', async () => {
    const res = await request(app).get('/nope?name=secret').set('X-Request-Id', 'req-404');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route GET /nope not found', requestId: 'req-404' },
    });
  });
});

describe('JSON body parsing', () => {
  it('rejects malformed JSON with 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Malformed JSON body',
    });
  });

  it('rejects a JSON body over 100 kB with 413', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'a@b.co', password: 'x'.repeat(101 * 1024) });

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});
