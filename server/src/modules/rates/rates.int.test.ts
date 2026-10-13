import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../../../test/app.ts';
import { signIn } from '../../../test/auth.ts';
import { resetDb, testPool } from '../../../test/db.ts';
import { insertEmployee } from '../../../test/factories.ts';

let app: ReturnType<typeof buildTestApp>;
let cookie: string;
let userId: string;

beforeEach(async () => {
  await resetDb();
  app = buildTestApp(); // now = 2026-10-12T09:00:00Z
  ({
    cookie,
    user: { id: userId },
  } = await signIn(app));
});
afterAll(() => testPool.end());

const get = (path: string) => request(app).get(`/api${path}`).set('Cookie', cookie);
const put = (currency: string, body: object) =>
  request(app).put(`/api/exchange-rates/${currency}`).set('Cookie', cookie).send(body);

describe('GET /api/countries and /api/exchange-rates', () => {
  it('lists countries with their currency, by name', async () => {
    const res = await get('/countries');

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(8);
    expect(res.body.items[0]).toEqual({ code: 'AU', name: 'Australia', currencyCode: 'AUD' });
  });

  it('lists every rate with its date and who last changed it', async () => {
    const res = await get('/exchange-rates');

    expect(res.status).toBe(200);
    expect(res.body.items.map((r: { currencyCode: string }) => r.currencyCode)).toEqual([
      'AUD',
      'CAD',
      'EUR',
      'GBP',
      'INR',
      'SGD',
      'USD',
    ]);
    expect(res.body.items.find((r: { currencyCode: string }) => r.currencyCode === 'USD')).toEqual({
      currencyCode: 'USD',
      inrPerUnit: '88.750000',
      asOf: '2026-10-01',
      updatedBy: null,
      updatedAt: expect.any(String),
    });
  });
});

describe('PUT /api/exchange-rates/:currency', () => {
  it('updates the rate and records old → new, who and when in the rate history', async () => {
    const res = await put('USD', { inrPerUnit: '90', asOf: '2026-10-12' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      currencyCode: 'USD',
      inrPerUnit: '90.000000',
      asOf: '2026-10-12',
      updatedBy: { id: userId, name: 'HR Manager' },
      updatedAt: '2026-10-12T09:00:00.000Z',
    });
    const history = await get('/exchange-rates/history');
    expect(history.body).toMatchObject({ total: 1, page: 1 });
    expect(history.body.items).toEqual([
      {
        id: expect.any(String),
        currencyCode: 'USD',
        oldInrPerUnit: '88.750000',
        newInrPerUnit: '90.000000',
        oldAsOf: '2026-10-01',
        newAsOf: '2026-10-12',
        changedBy: { id: userId, name: 'HR Manager' },
        changedAt: '2026-10-12T09:00:00.000Z',
      },
    ]);
  });

  it('converts salaries with the new rate straight away (EUR → USD)', async () => {
    await insertEmployee({ countryCode: 'FR', baseSalary: '60000' });
    await put('USD', { inrPerUnit: '90', asOf: '2026-10-12' });

    const res = await get('/employees?currency=USD');

    expect(res.body.items[0].convertedAnnualSalary).toBe('68800.00'); // 60,000 × 103.20 ÷ 90
    expect(res.body.ratesAsOf).toBe('2026-10-01'); // the oldest rate still in use
  });

  it('filters history by currency, newest first', async () => {
    await put('USD', { inrPerUnit: '89', asOf: '2026-10-05' });
    await put('EUR', { inrPerUnit: '104', asOf: '2026-10-06' });
    await put('USD', { inrPerUnit: '90', asOf: '2026-10-12' });

    const res = await get('/exchange-rates/history?currency=USD');

    expect(res.body.total).toBe(2);
    expect(res.body.items.map((h: { newInrPerUnit: string }) => h.newInrPerUnit)).toEqual([
      '90.000000',
      '89.000000',
    ]);
  });

  it.each([
    ['INR', { inrPerUnit: '2', asOf: '2026-10-12' }, 400, 'currency'],
    ['USD', { inrPerUnit: '0', asOf: '2026-10-12' }, 400, 'inrPerUnit'],
    ['USD', { inrPerUnit: '90', asOf: '2026-10-13' }, 400, 'asOf'],
  ])('rejects %s %j', async (currency, body, status, path) => {
    const res = await put(currency, body);

    expect(res.status).toBe(status);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual([path]);
    expect((await get('/exchange-rates/history')).body.total).toBe(0);
  });

  it('returns 404 for an unknown currency', async () => {
    const res = await put('XYZ', { inrPerUnit: '1.5', asOf: '2026-10-12' });

    expect(res.status).toBe(404);
  });
});

describe('exchange_rate_changes is append-only', () => {
  it.each([
    ['UPDATE', 'UPDATE exchange_rate_changes SET new_inr_per_unit = 1'],
    ['DELETE', 'DELETE FROM exchange_rate_changes'],
  ])('rejects %s at the database level', async (_case, sql) => {
    await put('USD', { inrPerUnit: '90', asOf: '2026-10-12' });

    await expect(testPool.query(sql)).rejects.toThrow(/exchange_rate_changes is append-only/);
  });
});
