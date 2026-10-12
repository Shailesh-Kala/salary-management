import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../../../test/app.ts';
import { resetDb, testPool } from '../../../test/db.ts';
import { createUser, disableUser, enableUser, resetPassword } from './user-admin.ts';

const EMAIL = 'hr@acme.local';
const OLD_PASSWORD = 'old password value';
const NEW_PASSWORD = 'new password value';

let app: ReturnType<typeof buildTestApp>;

beforeEach(async () => {
  await resetDb();
  app = buildTestApp();
  await createUser(testPool, { email: EMAIL, name: 'HR Manager', password: OLD_PASSWORD });
});
afterAll(() => testPool.end());

const login = (password: string) =>
  request(app).post('/api/auth/login').send({ email: EMAIL, password });

const me = (cookie: string) => request(app).get('/api/auth/me').set('Cookie', cookie);

const cookieOf = (res: request.Response) =>
  String(res.headers['set-cookie']?.[0]).split(';')[0] as string;

describe('resetPassword', () => {
  it('replaces the password and ends existing sessions, keeping the same user id', async () => {
    const before = await login(OLD_PASSWORD);

    expect(await resetPassword(testPool, ' HR@acme.local ', NEW_PASSWORD)).toBe(true);

    expect((await me(cookieOf(before))).status).toBe(401);
    expect((await login(OLD_PASSWORD)).status).toBe(401);
    const after = await login(NEW_PASSWORD);
    expect(after.status).toBe(200);
    expect(after.body.user.id).toBe(before.body.user.id);
  });

  it('reports when there is no such user', async () => {
    expect(await resetPassword(testPool, 'nobody@acme.local', NEW_PASSWORD)).toBe(false);
  });
});

describe('enableUser', () => {
  it('lets a disabled user log in again, while sessions from before the disable stay ended', async () => {
    const before = await login(OLD_PASSWORD);
    await disableUser(testPool, EMAIL);

    expect(await enableUser(testPool, EMAIL)).toBe(true);

    expect((await me(cookieOf(before))).status).toBe(401);
    expect((await login(OLD_PASSWORD)).status).toBe(200);
  });

  it('reports when there is no such user', async () => {
    expect(await enableUser(testPool, 'nobody@acme.local')).toBe(false);
  });
});
