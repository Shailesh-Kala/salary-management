import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createUser } from '../src/modules/auth/user-admin.ts';
import { testPool } from './db.ts';

/** Creates an HR user and logs in; returns the session cookie and the user. */
export async function signIn(app: App, email = 'hr@acme.local') {
  const password = 'correct horse battery staple';
  const user = await createUser(testPool, { email, name: 'HR Manager', password });
  const res = await request(app).post('/api/auth/login').send({ email, password });
  const cookie = String(res.headers['set-cookie']?.[0]).split(';')[0] as string;
  return { cookie, user };
}
