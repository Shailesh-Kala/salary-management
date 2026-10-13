import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createEmployeeSchema, nonNegativeAmount, positiveAmount } from './employee-rules.ts';

const AMOUNT_MESSAGE =
  'Enter a plain number like 95000 or 95000.50, with no commas or currency symbols';

const valid = {
  employeeCode: 'EMP-1',
  firstName: 'Asha',
  lastName: 'Verma',
  email: 'asha@acme.com',
  jobTitle: 'Engineer',
  department: 'Engineering',
  countryCode: 'IN',
  hireDate: '2024-04-01',
  baseSalary: '1800000',
};

/** The message for each failing field, as both the API and the web form show it. */
function messages(input: unknown) {
  const issues = createEmployeeSchema.safeParse(input).error?.issues ?? [];
  return issues.map((i) => [i.path.join('.'), i.message]);
}

describe('shared files', () => {
  // These files are also bundled into the web app, so they may only depend on zod.
  it('import nothing but zod and each other', () => {
    const dir = import.meta.dirname;
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

    const imports = files.flatMap((file) =>
      [
        ...readFileSync(path.join(dir, file), 'utf8').matchAll(
          /from\s+'([^']+)'|import\s+'([^']+)'/g,
        ),
      ].map((m) => [file, m[1] ?? m[2]]),
    );

    expect(files).toContain('employee-rules.ts');
    expect(imports.filter(([, from]) => from !== 'zod' && !from!.startsWith('./'))).toEqual([]);
  });
});

describe('zod in the server and the web app', () => {
  const root = path.join(import.meta.dirname, '../../..');
  const pinned = (workspace: string) =>
    JSON.parse(readFileSync(path.join(root, workspace, 'package.json'), 'utf8')).dependencies.zod;

  // The message map sets zod's global config, so a second copy would silently lose the messages
  // wherever the other copy is used.
  it('are one exact version, so the shared schema runs on the same zod as the web code', () => {
    expect(pinned('server')).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pinned('web')).toBe(pinned('server'));
  });

  it('resolve to one installed copy from the shared folder, the server and the web code', () => {
    const resolveFrom = (file: string) => createRequire(path.join(root, file)).resolve('zod');

    expect(resolveFrom('web/src/lib/validation.ts')).toBe(
      resolveFrom('server/src/shared/employee-rules.ts'),
    );
    expect(resolveFrom('server/src/app.ts')).toBe(
      resolveFrom('server/src/shared/employee-rules.ts'),
    );
  });
});

describe('createEmployeeSchema messages', () => {
  it('tells you what to enter for each missing field', () => {
    expect(messages({})).toEqual([
      ['employeeCode', 'Enter an employee code, like EMP-00001'],
      ['firstName', 'Enter the first name'],
      ['lastName', 'Enter the last name'],
      ['email', 'Enter the work email'],
      ['jobTitle', 'Enter the job title'],
      ['department', 'Enter the department'],
      ['countryCode', 'Choose a country'],
      ['hireDate', 'Choose the hire date'],
      ['baseSalary', 'Enter the annual base salary'],
    ]);
  });

  it('says what is wrong with blank or malformed values, one message per field', () => {
    expect(
      messages({
        ...valid,
        employeeCode: '',
        firstName: '   ',
        email: '',
        hireDate: '2024-13-45',
        baseSalary: '1,800,000',
        allowances: '-5',
      }),
    ).toEqual([
      ['employeeCode', 'Enter an employee code, like EMP-00001'],
      ['firstName', 'Enter the first name'],
      ['email', 'Enter the work email'],
      ['hireDate', 'Enter a valid date as YYYY-MM-DD'],
      ['baseSalary', AMOUNT_MESSAGE],
      ['allowances', AMOUNT_MESSAGE],
    ]);
    expect(messages({ ...valid, employeeCode: 'EMP 1!', email: 'asha' })).toEqual([
      ['employeeCode', 'Use only letters, digits, - or _ (up to 20 characters)'],
      ['email', 'Enter a valid email address, like name@company.com'],
    ]);
    expect(messages({ ...valid, baseSalary: '0' })).toEqual([
      ['baseSalary', 'Must be greater than 0'],
    ]);
  });
});

describe('positiveAmount', () => {
  it.each([
    ['95000', '95000'],
    ['95000.5', '95000.5'],
    [' 95000.50 ', '95000.50'],
    [95000, '95000'],
    [0.01, '0.01'],
    ['999999999999.99', '999999999999.99'],
  ])('accepts %j as %j', (input, expected) => {
    expect(positiveAmount.parse(input)).toBe(expected);
  });

  it.each([
    ['zero', '0'],
    ['zero with decimals', '0.00'],
    ['negative', '-1'],
    ['thousands separator', '95,000'],
    ['currency symbol', '$95000'],
    ['three decimals', '95000.123'],
    ['exponent', '1e5'],
    ['exponent number', 1e-7],
    ['empty', ''],
    ['text', 'abc'],
    ['over NUMERIC(14,2)', '1000000000000'],
    ['not a number', Number.NaN],
  ])('rejects %s', (_case, input) => {
    expect(positiveAmount.safeParse(input).success).toBe(false);
  });

  it('reports exactly one error for a malformed amount', () => {
    expect(positiveAmount.safeParse('-1').error?.issues).toHaveLength(1);
  });
});

describe('nonNegativeAmount', () => {
  it('accepts zero but not negatives', () => {
    expect(nonNegativeAmount.parse('0')).toBe('0');
    expect(nonNegativeAmount.safeParse('-0.01').success).toBe(false);
  });
});
