export type EmployeeFormValues = {
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string;
  department: string;
  countryCode: string;
  hireDate: string;
  baseSalary: string;
  allowances: string;
};

export type FormErrors<T> = Partial<Record<keyof T, string>>;

const MAX_TEXT = 100;
const PLAIN_AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMPLOYEE_CODE = /^[A-Za-z0-9_-]{1,20}$/;

const amountFormat = (example: string) =>
  `Enter a plain number like ${example} or ${example}.50, with no commas or currency symbols`;

/**
 * Checks the create-employee form before anything is sent, with a message saying what to enter.
 * The server checks the same rules again and stays the authority; its messages are still shown.
 */
export function validateEmployeeForm(form: EmployeeFormValues): FormErrors<EmployeeFormValues> {
  const errors: FormErrors<EmployeeFormValues> = {};
  const value = (name: keyof EmployeeFormValues) => form[name].trim();

  const required = (name: keyof EmployeeFormValues, message: string) => {
    if (value(name) === '') errors[name] = message;
    return value(name) !== '';
  };
  const text = (name: keyof EmployeeFormValues, message: string) => {
    if (required(name, message) && value(name).length > MAX_TEXT) {
      errors[name] = `Use at most ${MAX_TEXT} characters`;
    }
  };

  if (
    required('employeeCode', 'Enter an employee code, like EMP-00001') &&
    !EMPLOYEE_CODE.test(value('employeeCode'))
  ) {
    errors.employeeCode = 'Use only letters, digits, - or _ (up to 20 characters)';
  }
  text('firstName', 'Enter the first name');
  text('lastName', 'Enter the last name');
  if (required('email', 'Enter the work email') && !EMAIL.test(value('email'))) {
    errors.email = 'Enter a valid email address, like name@company.com';
  }
  text('jobTitle', 'Enter the job title');
  text('department', 'Enter the department');
  required('countryCode', 'Choose a country');
  required('hireDate', 'Choose the hire date');

  if (required('baseSalary', 'Enter the annual base salary')) {
    if (!PLAIN_AMOUNT.test(value('baseSalary'))) errors.baseSalary = amountFormat('1800000');
    else if (Number(value('baseSalary')) === 0)
      errors.baseSalary = 'Base salary must be greater than 0';
  }
  if (value('allowances') !== '' && !PLAIN_AMOUNT.test(value('allowances'))) {
    errors.allowances = amountFormat('200000');
  }
  return errors;
}
