import { describe, expect, it } from 'vitest';
import { validateEmployeeForm } from './validation.ts';

const valid = {
  employeeCode: 'EMP-00001',
  firstName: 'Asha',
  lastName: 'Verma',
  email: 'asha.verma@acme.com',
  jobTitle: 'Software Engineer',
  department: 'Engineering',
  countryCode: 'IN',
  hireDate: '2024-04-01',
  baseSalary: '1800000',
  allowances: '',
};

describe('validateEmployeeForm', () => {
  it('accepts a complete form; allowances may be blank', () => {
    expect(validateEmployeeForm(valid)).toEqual({});
    expect(validateEmployeeForm({ ...valid, allowances: '0' })).toEqual({});
    expect(
      validateEmployeeForm({ ...valid, allowances: '2500.50', baseSalary: '95000.5' }),
    ).toEqual({});
  });

  it('says what to enter for every empty required field', () => {
    const blank = Object.fromEntries(Object.keys(valid).map((k) => [k, ' '])) as typeof valid;

    expect(validateEmployeeForm(blank)).toEqual({
      employeeCode: 'Enter an employee code, like EMP-00001',
      firstName: 'Enter the first name',
      lastName: 'Enter the last name',
      email: 'Enter the work email',
      jobTitle: 'Enter the job title',
      department: 'Enter the department',
      countryCode: 'Choose a country',
      hireDate: 'Choose the hire date',
      baseSalary: 'Enter the annual base salary',
    });
  });

  it('explains a malformed code, email and name', () => {
    expect(
      validateEmployeeForm({
        ...valid,
        employeeCode: 'EMP 1!',
        email: 'asha.verma',
        firstName: 'x'.repeat(101),
      }),
    ).toEqual({
      employeeCode: 'Use only letters, digits, - or _ (up to 20 characters)',
      email: 'Enter a valid email address, like name@company.com',
      firstName: 'Use at most 100 characters',
    });
  });

  it.each(['1,800,000', '₹1800000', '18e5', '-5', '1.234', 'abc'])(
    'rejects the amount %s with the expected format',
    (amount) => {
      const message =
        'Enter a plain number like 1800000 or 1800000.50, with no commas or currency symbols';

      expect(validateEmployeeForm({ ...valid, baseSalary: amount })).toEqual({
        baseSalary: message,
      });
      expect(validateEmployeeForm({ ...valid, allowances: amount })).toEqual({
        allowances: message.replace('1800000', '200000').replace('1800000.50', '200000.50'),
      });
    },
  );

  it('requires a base salary above zero', () => {
    expect(validateEmployeeForm({ ...valid, baseSalary: '0' })).toEqual({
      baseSalary: 'Base salary must be greater than 0',
    });
  });
});
