import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, fixedClock, type TestClock } from '../../../test/app.ts';
import { resetDb, testPool } from '../../../test/db.ts';
import { createUser, disableUser } from './user-admin.ts';

const EMAIL = 'hr@acme.local';
const PASSWORD = 'correct horse battery staple';
const EIGHT_HOURS = 8 * 60 * 60 * 1000;

let clock: TestClock;
let app: ReturnType<typeof buildTestApp>;

beforeEach(async () => {
  await resetDb();
  clock = fixedClock();
  app = buildTestApp({ clock });
  await createUser(testPool, { email: EMAIL, name: 'HR Manager', password: PASSWORD });
});
afterAll(() => testPool.end());

const login = (email = EMAIL, password = PASSWORD) =>
  request(app).post('/api/auth/login').send({ email, password });

const sessionCookie = (res: request.Response) =>
  String(res.headers['set-cookie']?.[0]).split(';')[0] as string;

const me = (cookie?: string) => {
  const req = request(app).get('/api/auth/me');
  return cookie ? req.set('Cookie', cookie) : req;
};

describe('POST /api/auth/login', () => {
  it('sets an httpOnly, SameSite=Strict, Secure 8 h session cookie and returns the user', async () => {
    const res = await login(' HR@Acme.LOCAL ');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      user: { id: expect.any(String), email: EMAIL, name: 'HR Manager' },
    });
    const cookie = String(res.headers['set-cookie']?.[0]);
    expect(cookie).toMatch(/^sid=[^;]+;/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=28800');
  });

  it.each([
    ['a wrong password', EMAIL, 'wrong password'],
    ['an unknown email', 'nobody@acme.local', PASSWORD],
  ])('returns the same generic 401 for %s and sets no cookie', async (_case, email, password) => {
    const res = await login(email, password);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({
      code: 'UNAUTHENTICATED',
      message: 'Invalid email or password',
    });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('rejects a malformed body with field-level validation errors', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual([
      'email',
      'password',
    ]);
  });
});

describe('session', () => {
  it('GET /api/auth/me returns the logged-in user', async () => {
    const cookie = sessionCookie(await login());

    const res = await me(cookie);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: EMAIL, name: 'HR Manager' });
  });

  it('requires a session for /api/auth/me', async () => {
    const res = await me();

    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({
      code: 'UNAUTHENTICATED',
      message: 'Authentication required',
    });
  });

  it('protects every /api route, including unknown ones', async () => {
    const res = await request(app).get('/api/employees');

    expect(res.status).toBe(401);
  });

  it('rejects a tampered token', async () => {
    const cookie = sessionCookie(await login());

    const res = await me(`${cookie.slice(0, -2)}xx`);

    expect(res.status).toBe(401);
  });

  it('accepts the session just before 8 hours and rejects it after', async () => {
    const cookie = sessionCookie(await login());

    clock.advance(EIGHT_HOURS - 1000);
    expect((await me(cookie)).status).toBe(200);

    clock.advance(2000);
    expect((await me(cookie)).status).toBe(401);
  });
});

describe('logout and revocation (T16)', () => {
  it('logout clears the cookie and the replayed old token is rejected', async () => {
    const cookie = sessionCookie(await login());

    const res = await request(app).post('/api/auth/logout').set('Cookie', cookie);

    expect(res.status).toBe(204);
    expect(String(res.headers['set-cookie']?.[0])).toMatch(/^sid=;.*Expires=Thu, 01 Jan 1970/);
    expect((await me(cookie)).status).toBe(401);
  });

  it('disabling a user ends their existing session and blocks new logins', async () => {
    const cookie = sessionCookie(await login());

    expect(await disableUser(testPool, EMAIL)).toBe(true);

    expect((await me(cookie)).status).toBe(401);
    const again = await login();
    expect(again.status).toBe(401);
    expect(again.body.error.message).toBe('Invalid email or password');
  });

  it('reports when there is no user to disable', async () => {
    expect(await disableUser(testPool, 'nobody@acme.local')).toBe(false);
  });
});
