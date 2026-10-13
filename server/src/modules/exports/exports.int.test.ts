import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../../../test/app.ts';
import { signIn } from '../../../test/auth.ts';
import { resetDb, testPool } from '../../../test/db.ts';
import { insertEmployee } from '../../../test/factories.ts';

const HEADER = [
  'employee_code',
  'first_name',
  'last_name',
  'email',
  'job_title',
  'department',
  'country',
  'hire_date',
  'base_salary',
  'allowances',
  'currency',
  'status',
  'last_working_day',
];

let app: ReturnType<typeof buildTestApp>;
let cookie: string;
let userId: string;

beforeAll(async () => {
  await resetDb();
  app = buildTestApp(); // today = 2026-10-12
  ({
    cookie,
    user: { id: userId },
  } = await signIn(app));
  await insertEmployee({
    employeeCode: 'EMP-1',
    email: 'e1@acme.com',
    baseSalary: '1800000',
    allowances: '200000',
  });
  await insertEmployee({
    employeeCode: 'EMP-2',
    email: 'e2@acme.com',
    firstName: '=HYPERLINK("http://evil.example","click")',
    countryCode: 'US',
    baseSalary: '150000',
    allowances: '10000',
    exitType: 'resigned',
    noticeDate: '2026-10-01',
    lastWorkingDay: '2026-11-30',
  });
  await insertEmployee({
    employeeCode: 'EMP-3',
    email: 'e3@acme.com',
    countryCode: 'FR',
    baseSalary: '60000',
  });
});
afterAll(() => testPool.end());

const download = (query: string) =>
  request(app)
    .get(`/api/exports/employees?${query}`)
    .set('Cookie', cookie)
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });

const csvRows = (res: request.Response) =>
  parse((res.body as Buffer).toString('utf8'), { bom: true }) as string[][];

describe('GET /api/exports/employees?format=csv', () => {
  it('streams the filtered list as UTF-8 CSV with a converted-salary column', async () => {
    const res = await download('format=csv&sort=employeeCode');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="employees-2026-10-12.csv"',
    );
    const [header, ...rows] = csvRows(res);
    expect(header).toEqual([...HEADER, 'annual_salary_inr']);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual([
      'EMP-1',
      'Asha',
      'Verma',
      'e1@acme.com',
      'Software Engineer',
      'Engineering',
      'IN',
      '2024-04-01',
      '1800000.00',
      '200000.00',
      'INR',
      'active',
      '',
      '2000000.00',
    ]);
    expect(rows[1]).toMatchObject({
      10: 'USD',
      11: 'on_notice',
      12: '2026-11-30',
      13: '14200000.00',
    });
  });

  it('writes amounts as plain numbers with no digit grouping, ready to re-import', async () => {
    const [, , second] = csvRows(await download('format=csv&sort=employeeCode'));

    expect(second!.slice(8, 10)).toEqual(['150000.00', '10000.00']);
    expect(second![13]).toBe('14200000.00');
  });

  it('escapes cells that a spreadsheet would run as a formula', async () => {
    const [, , second] = csvRows(await download('format=csv&sort=employeeCode'));

    expect(second![1]).toBe(`'=HYPERLINK("http://evil.example","click")`);
  });

  it('applies the list filters and reporting currency', async () => {
    const [header, ...rows] = csvRows(await download('format=csv&country=FR&currency=EUR'));

    expect(header!.at(-1)).toBe('annual_salary_eur');
    expect(rows).toEqual([expect.arrayContaining(['EMP-3', '60000.00'])]);
  });
});

describe('GET /api/exports/employees?format=xlsx', () => {
  it('streams a one-sheet workbook with typed cells and a frozen header', async () => {
    const res = await download('format=xlsx&sort=employeeCode');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="employees-2026-10-12.xlsx"',
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(new Uint8Array(res.body as Buffer).buffer);
    const sheet = workbook.worksheets[0]!;
    expect(workbook.worksheets).toHaveLength(1);
    expect(sheet.rowCount).toBe(4);
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(sheet.getRow(1).values).toEqual([undefined, ...HEADER, 'annual_salary_inr']);
    const first = sheet.getRow(2);
    expect(first.getCell(9).value).toBe(1800000); // base salary as a number
    expect(first.getCell(9).numFmt).toBe('0.00'); // plain number: no digit grouping in files
    expect(first.getCell(14).numFmt).toBe('0.00');
    expect(first.getCell(14).value).toBe(2000000); // converted annual salary as a number
    expect(first.getCell(8).value).toEqual(new Date('2024-04-01T00:00:00Z')); // hire date as a date
    expect(sheet.getRow(3).getCell(2).value).toBe(`'=HYPERLINK("http://evil.example","click")`);
  });
});

describe('export audit', () => {
  it('records who exported what, with which filters and how many rows', async () => {
    await testPool.query('TRUNCATE exports CASCADE');

    await download('format=csv&country=IN&currency=USD');

    const { rows } = await testPool.query(
      'SELECT requested_by, format, delivery, filters, row_count FROM exports',
    );
    expect(rows).toEqual([
      {
        requested_by: userId,
        format: 'csv',
        delivery: 'direct',
        filters: expect.objectContaining({ country: 'IN', currency: 'USD' }),
        row_count: 1,
      },
    ]);
  });

  it('rejects an unknown format', async () => {
    const res = await request(app).get('/api/exports/employees?format=docx').set('Cookie', cookie);

    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(['format']);
  });
});
