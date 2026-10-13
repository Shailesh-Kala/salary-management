import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createUser } from '../src/modules/auth/user-admin.ts';
import { testPool } from './db.ts';

const PASSWORD = 'correct horse battery staple';

/** Logs an existing test user in again (e.g. after the clock moved past their session). */
export async function logIn(app: App, email = 'hr@acme.local') {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  return String(res.headers['set-cookie']?.[0]).split(';')[0] as string;
}

/** Creates an HR user and logs in; returns the session cookie and the user. */
export async function signIn(app: App, email = 'hr@acme.local') {
  const user = await createUser(testPool, { email, name: 'HR Manager', password: PASSWORD });
  return { cookie: await logIn(app, email), user };
}
