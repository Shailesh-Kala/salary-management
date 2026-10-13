import { createEmployeeSchema } from '@shared/employee-rules.ts';

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

/** What the server receives: blank fields are left out, so required ones are reported missing. */
export const withoutBlanks = (values: EmployeeFormValues) =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim() !== ''));

/**
 * Checks the create-employee form with the same schema the server uses (src/shared), so the
 * rules and their messages cannot differ. Checks that need the database stay on the server and
 * their messages are shown when they come back.
 */
export function validateEmployeeForm(form: EmployeeFormValues): FormErrors<EmployeeFormValues> {
  const result = createEmployeeSchema.safeParse(withoutBlanks(form));
  const errors: FormErrors<EmployeeFormValues> = {};
  for (const issue of result.error?.issues ?? []) {
    const field = issue.path[0] as keyof EmployeeFormValues;
    errors[field] ??= issue.message;
  }
  return errors;
}
