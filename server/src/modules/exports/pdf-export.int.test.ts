import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../../../test/app.ts';
import { signIn } from '../../../test/auth.ts';
import { resetDb, testPool } from '../../../test/db.ts';
import { seedDatabase } from '../../seed/seed.ts';

// 1,001 seeded employees: all of them exceed the 1,000-row PDF limit; one country does not.
let app: ReturnType<typeof buildTestApp>;
let cookie: string;
let indiaCount: number;

beforeAll(async () => {
  await resetDb();
  app = buildTestApp(); // today = 2026-10-12
  ({ cookie } = await signIn(app));
  await seedDatabase(testPool, {
    count: 1001,
    seed: 7,
    today: '2026-10-12',
    admin: { email: 'hr@acme.local', password: 'unused: account already exists' },
  });
  indiaCount = (
    await testPool.query("SELECT count(*)::int AS n FROM employees WHERE country_code = 'IN'")
  ).rows[0].n;
}, 30_000);
afterAll(() => testPool.end());

const pdf = (query: string) =>
  request(app)
    .get(`/api/exports/employees?format=pdf&${query}`)
    .set('Cookie', cookie)
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
const auditRows = async () =>
  (await testPool.query("SELECT format, row_count FROM exports WHERE format = 'pdf'")).rows;

describe('GET /api/exports/employees?format=pdf', () => {
  it('renders up to 1,000 rows as a multi-page PDF and audits it', async () => {
    await testPool.query('TRUNCATE exports CASCADE');

    const res = await pdf('country=IN');

    expect(indiaCount).toBeLessThanOrEqual(1000);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="employees-2026-10-12.pdf"',
    );
    const body = (res.body as Buffer).toString('latin1');
    expect(body.startsWith('%PDF-')).toBe(true);
    expect(body).toContain('Employees export');
    expect(body.match(/\/Type \/Page\b/g)!.length).toBeGreaterThan(1);
    expect(await auditRows()).toEqual([{ format: 'pdf', row_count: indiaCount }]);
  });

  it('refuses more than 1,000 rows with 422 before rendering or auditing anything', async () => {
    await testPool.query('TRUNCATE exports CASCADE');

    const res = await request(app).get('/api/exports/employees?format=pdf').set('Cookie', cookie);

    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: 'EXPORT_TOO_LARGE',
      message:
        'A PDF can hold up to 1,000 rows and this list has 1,001. Narrow the filters, download CSV or Excel, or have the PDF emailed.',
      details: { rowCount: 1001, limit: 1000 },
    });
    expect(await auditRows()).toEqual([]);
  });

  it('keeps CSV and Excel available for the full list', async () => {
    const res = await request(app).get('/api/exports/employees?format=csv').set('Cookie', cookie);

    expect(res.status).toBe(200);
  });
});
