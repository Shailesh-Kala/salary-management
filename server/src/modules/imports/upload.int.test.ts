import { parse } from 'csv-parse/sync';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../../../test/app.ts';
import { signIn } from '../../../test/auth.ts';
import { resetDb, testPool } from '../../../test/db.ts';

const HEADER =
  'employee_code,first_name,last_name,email,job_title,department,country,hire_date,base_salary,allowances';
const ROWS = [
  'EMP-1,Asha,Verma,asha@acme.com,Software Engineer,Engineering,IN,2024-04-01,1800000,200000',
  'EMP-2,Ben,Carter,ben@acme.com,Software Engineer,Engineering,US,2023-01-15,150000,10000',
];
const FORM = {
  changeType: 'annual_review',
  effectiveDate: '2026-10-01',
  note: 'FY26 annual review',
};

let app: ReturnType<typeof buildTestApp>;
let cookie: string;

beforeEach(async () => {
  await resetDb();
  app = buildTestApp(); // today = 2026-10-12
  ({ cookie } = await signIn(app));
});
afterAll(() => testPool.end());

const upload = (
  content: string | Buffer,
  form: Record<string, string> = FORM,
  name = 'employees.csv',
) => {
  const req = request(app).post('/api/imports').set('Cookie', cookie);
  for (const [key, value] of Object.entries(form)) req.field(key, value);
  return req.attach('file', Buffer.from(content), name);
};
const count = async (table: string) =>
  (await testPool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;

describe('GET /api/imports/template', () => {
  it('downloads the header and three example rows', async () => {
    const res = await request(app).get('/api/imports/template').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="employee-import-template.csv"',
    );
    const [header, ...rows] = parse(res.text, { bom: true }) as string[][];
    expect(header!.join(',')).toBe(HEADER);
    expect(rows.map((r) => r[0])).toEqual(['EXAMPLE-1', 'EXAMPLE-2', 'EXAMPLE-3']);
  });
});

describe('POST /api/imports', () => {
  it('accepts a valid file with 202, stores it and queues validation', async () => {
    const res = await upload([HEADER, ...ROWS].join('\n'));

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ id: expect.any(String), status: 'validating', rowCount: 2 });
    const { rows } = await testPool.query(
      `SELECT status, file_name, change_type, effective_date, note, row_count, octet_length(file) AS bytes FROM imports`,
    );
    expect(rows).toEqual([
      {
        status: 'validating',
        file_name: 'employees.csv',
        change_type: 'annual_review',
        effective_date: '2026-10-01',
        note: 'FY26 annual review',
        row_count: 2,
        bytes: expect.any(Number),
      },
    ]);
    const jobs = await testPool.query('SELECT type, payload FROM jobs');
    expect(jobs.rows).toEqual([{ type: 'import_validate', payload: { importId: res.body.id } }]);
  });

  it.each([
    ['a non-CSV file', [HEADER, ...ROWS].join('\n'), FORM, 'data.xlsx', 400, 'file'],
    [
      'a header that differs from the template',
      'code,name\nEMP-1,Asha',
      FORM,
      'employees.csv',
      400,
      'file',
    ],
    ['no data rows', HEADER, FORM, 'employees.csv', 400, 'file'],
    [
      'a missing note',
      [HEADER, ...ROWS].join('\n'),
      { ...FORM, note: '' },
      'employees.csv',
      400,
      'note',
    ],
    [
      'a future effective date',
      [HEADER, ...ROWS].join('\n'),
      { ...FORM, effectiveDate: '2026-10-13' },
      'employees.csv',
      400,
      'effectiveDate',
    ],
  ])(
    'rejects %s without storing or queueing anything',
    async (_case, content, form, name, status, path) => {
      const res = await upload(content, form, name);

      expect(res.status).toBe(status);
      expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual([path]);
      expect(await count('imports')).toBe(0);
      expect(await count('jobs')).toBe(0);
    },
  );

  it('rejects a file over 5 MB with 413', async () => {
    const res = await upload(Buffer.alloc(5 * 1024 * 1024 + 10, 'a'));

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(await count('imports')).toBe(0);
  });
});

describe('one active import at a time (T10)', () => {
  it('refuses a second upload while one is in progress, then accepts it once that one ends', async () => {
    const first = await upload([HEADER, ...ROWS].join('\n'));

    const second = await upload([HEADER, ...ROWS].join('\n'));

    expect(second.status).toBe(409);
    expect(second.body.error).toMatchObject({
      code: 'IMPORT_IN_PROGRESS',
      details: { importId: first.body.id },
    });
    expect(await count('imports')).toBe(1);
    expect(await count('jobs')).toBe(1);

    for (const status of ['awaiting_confirmation', 'applying']) {
      await testPool.query('UPDATE imports SET status = $1', [status]);
      expect((await upload([HEADER, ...ROWS].join('\n'))).status).toBe(409);
    }

    await testPool.query("UPDATE imports SET status = 'cancelled'");
    const third = await upload([HEADER, ...ROWS].join('\n'));

    expect(third.status).toBe(202);
  });
});
