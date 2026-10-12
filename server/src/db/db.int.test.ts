import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { pino } from 'pino';
import { resetDb, testPool } from '../../test/db.ts';
import { createApp } from '../app.ts';
import { withTransaction } from './transaction.ts';

beforeEach(resetDb);
afterAll(() => testPool.end());

const countUsers = async () =>
  (await testPool.query('SELECT count(*)::int AS n FROM hr_users')).rows[0].n;

const insertUser = (client: { query: typeof testPool.query }) =>
  client.query(
    "INSERT INTO hr_users (email, name, password_hash) VALUES ('a@acme.local', 'A', 'x')",
  );

describe('database connection', () => {
  it('returns DATE columns as the identical YYYY-MM-DD string in a non-UTC process (T17)', async () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Los_Angeles');

    const { rows } = await testPool.query("SELECT '2026-03-31'::date AS d");

    expect(rows[0].d).toBe('2026-03-31');
  });

  it('runs sessions in UTC with a 5 s statement timeout', async () => {
    const tz = await testPool.query('SHOW timezone');
    const timeout = await testPool.query('SHOW statement_timeout');

    expect(tz.rows[0].TimeZone).toBe('UTC');
    expect(timeout.rows[0].statement_timeout).toBe('5s');
  });

  it('reports the database as up on /health', async () => {
    const app = createApp({ logger: pino({ level: 'silent' }), db: testPool });

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'ok' });
  });
});

describe('reference data', () => {
  it('has the 8 supported countries, each with a rate, and INR fixed at 1', async () => {
    const { rows } = await testPool.query(
      `SELECT c.code, c.currency_code, r.inr_per_unit
         FROM countries c JOIN exchange_rates r USING (currency_code) ORDER BY c.code`,
    );

    expect(rows.map((r) => r.code)).toEqual(['AU', 'CA', 'DE', 'FR', 'GB', 'IN', 'SG', 'US']);
    expect(rows.find((r) => r.code === 'IN')).toEqual({
      code: 'IN',
      currency_code: 'INR',
      inr_per_unit: '1.000000',
    });
  });
});

describe('withTransaction', () => {
  it('commits when the callback succeeds', async () => {
    await withTransaction(testPool, insertUser);

    expect(await countUsers()).toBe(1);
  });

  it('rolls back every statement and rethrows when the callback throws', async () => {
    const failure = new Error('second step failed');

    const run = withTransaction(testPool, async (client) => {
      await insertUser(client);
      throw failure;
    });

    await expect(run).rejects.toBe(failure);
    expect(await countUsers()).toBe(0);
  });
});
