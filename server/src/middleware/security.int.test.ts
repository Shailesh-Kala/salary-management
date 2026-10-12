import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { pino } from 'pino';
import { buildTestApp } from '../../test/app.ts';
import { resetDb, testPool } from '../../test/db.ts';
import { createUser } from '../modules/auth/user-admin.ts';

const EMAIL = 'hr@acme.local';
const PASSWORD = 'correct horse battery staple';
const FRONTEND = 'http://localhost:5173';

let app: ReturnType<typeof buildTestApp>;

beforeEach(async () => {
  await resetDb();
  app = buildTestApp({ config: { CORS_ORIGIN: FRONTEND } });
  await createUser(testPool, { email: EMAIL, name: 'HR Manager', password: PASSWORD });
});
afterAll(() => testPool.end());

const login = (email: string, password: string, target = app) =>
  request(target).post('/api/auth/login').send({ email, password });

const cookieOf = (res: request.Response) =>
  String(res.headers['set-cookie']?.[0]).split(';')[0] as string;

describe('login rate limits', () => {
  it('blocks the 6th attempt for the same email from one IP within a minute', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await login(EMAIL, 'wrong password')).status).toBe(401);
    }

    const res = await login(EMAIL, PASSWORD);

    expect(res.status).toBe(429);
    expect(res.body.error).toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('blocks the 21st attempt from one IP even when every email is different', async () => {
    for (let i = 0; i < 20; i++) {
      expect((await login(`user${i}@acme.local`, 'x')).status).toBe(401);
    }

    const res = await login('user20@acme.local', 'x');

    expect(res.status).toBe(429);
  });
});

describe('API rate limit', () => {
  it('allows 300 requests per user per minute, then returns 429 with Retry-After', async () => {
    const cookie = cookieOf(await login(EMAIL, PASSWORD));
    const statuses = new Set<number>();
    for (let i = 0; i < 300; i++) {
      statuses.add((await request(app).get('/api/auth/me').set('Cookie', cookie)).status);
    }

    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);

    expect([...statuses]).toEqual([200]);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  }, 30_000);
});

describe('security headers', () => {
  it('sets helmet headers and hides the framework', async () => {
    const res = await request(app).get('/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('CORS', () => {
  it('allows the frontend origin with credentials', async () => {
    const res = await request(app).get('/health').set('Origin', FRONTEND);

    expect(res.headers['access-control-allow-origin']).toBe(FRONTEND);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('sends no CORS headers to any other origin', async () => {
    const res = await request(app).get('/health').set('Origin', 'https://evil.example');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('request logging', () => {
  it('logs request id, method, path and status, but no cookie, query, body or password', async () => {
    const lines: string[] = [];
    const logger = pino({}, { write: (line: string) => lines.push(line) });
    const logged = buildTestApp({ logger });
    const loginRes = await login(EMAIL, PASSWORD, logged);
    const cookie = cookieOf(loginRes);

    await request(logged)
      .get('/api/auth/me?q=Asha+Verma&minSalary=95000')
      .set('Cookie', cookie)
      .set('X-Request-Id', 'req-log-1');

    const log = lines.join('\n');
    expect(log).toContain('"id":"req-log-1"');
    expect(log).toContain('"path":"/api/auth/me"');
    expect(log).toContain('"statusCode":200');
    expect(log).not.toContain(cookie.split('=')[1]);
    expect(log).not.toContain('Asha');
    expect(log).not.toContain('95000');
    expect(log).not.toContain(PASSWORD);
    expect(log).not.toContain(EMAIL);
  });
});
