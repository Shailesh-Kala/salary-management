import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { pino } from 'pino';
import type { Pool } from 'pg';
import { createApp } from './app.ts';

const fakeDb = (query: () => Promise<unknown>) => ({ query }) as unknown as Pool;
const logger = pino({ level: 'silent' });
const app = createApp({ logger, db: fakeDb(async () => ({ rows: [] })) });

describe('GET /health', () => {
  it('returns ok and echoes the incoming request id', async () => {
    const res = await request(app).get('/health').set('X-Request-Id', 'req-123');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'ok' });
    expect(res.headers['x-request-id']).toBe('req-123');
  });

  it('returns 503 when the database check fails', async () => {
    const downApp = createApp({
      logger,
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
