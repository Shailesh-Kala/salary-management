import { describe, expect, it } from 'vitest';
import { createEmployeeSchema } from '../../shared/employee-rules.ts';

const valid = {
  employeeCode: ' emp-00001 ',
  firstName: ' Asha ',
  lastName: 'Verma',
  email: ' Asha.Verma@ACME.com ',
  jobTitle: 'Software Engineer',
  department: 'Engineering',
  countryCode: 'in',
  hireDate: '2024-04-01',
  baseSalary: '1800000',
};

const errorPaths = (input: unknown) =>
  createEmployeeSchema.safeParse(input).error?.issues.map((i) => i.path.join('.'));

describe('createEmployeeSchema', () => {
  it('trims and normalises fields and defaults allowances to 0', () => {
    expect(createEmployeeSchema.parse(valid)).toEqual({
      employeeCode: 'EMP-00001',
      firstName: 'Asha',
      lastName: 'Verma',
      email: 'asha.verma@acme.com',
      jobTitle: 'Software Engineer',
      department: 'Engineering',
      countryCode: 'IN',
      hireDate: '2024-04-01',
      baseSalary: '1800000',
      allowances: '0',
    });
  });

  it('names every missing required field', () => {
    expect(errorPaths({})).toEqual([
      'employeeCode',
      'firstName',
      'lastName',
      'email',
      'jobTitle',
      'department',
      'countryCode',
      'hireDate',
      'baseSalary',
    ]);
  });

  it.each([
    ['employeeCode', 'EMP 001'],
    ['email', 'not-an-email'],
    ['countryCode', 'IND'],
    ['hireDate', '2026-02-30'],
    ['hireDate', '01/04/2024'],
    ['baseSalary', '0'],
    ['allowances', '-5'],
    ['firstName', '   '],
    ['note', 'ok'],
  ])('rejects an invalid %s (%j)', (field, value) => {
    expect(errorPaths({ ...valid, [field]: value })).toEqual([field]);
  });

  it('rejects unknown fields', () => {
    expect(errorPaths({ ...valid, status: 'exited' })).toEqual(['']);
  });
});
