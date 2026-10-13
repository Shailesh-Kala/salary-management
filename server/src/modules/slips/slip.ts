import { lastDayOfMonth } from '../../lib/dates.ts';
import { invalidField } from '../../lib/errors.ts';
import { addAmounts, annualToMonthly } from '../../lib/money.ts';
import type { EmployeeRow } from '../employees/employees.repository.ts';
import { employeeStatus } from '../employees/status.ts';

export type SlipEmployee = Pick<
  EmployeeRow,
  | 'id'
  | 'employeeCode'
  | 'firstName'
  | 'lastName'
  | 'hireDate'
  | 'exitType'
  | 'noticeDate'
  | 'lastWorkingDay'
>;

/** Pay, role and place in effect at the end of the month (from the change history). */
export type SlipSnapshot = {
  baseSalary: string;
  allowances: string;
  currencyCode: string;
  countryCode: string;
  countryName: string;
  jobTitle: string;
  department: string;
};

/** Monthly gross pay slip (REQUIREMENTS §4.6, D-009): no deductions, nothing stored. */
export function buildSlip({
  employee,
  snapshot,
  month,
  today,
}: {
  employee: SlipEmployee;
  snapshot: SlipSnapshot;
  month: string;
  today: string;
}) {
  const periodStart = `${month}-01`;
  const periodEnd = lastDayOfMonth(month);
  const name = `${employee.firstName} ${employee.lastName}`;

  if (month > today.slice(0, 7)) {
    throw invalidField('month', 'Slips can only be generated for the current or past months');
  }
  if (employee.hireDate > periodEnd) {
    throw invalidField('month', `${name} joined on ${employee.hireDate}`);
  }
  if (employee.lastWorkingDay && employee.lastWorkingDay < periodStart) {
    throw invalidField('month', `${name}'s last working day was ${employee.lastWorkingDay}`);
  }

  const base = annualToMonthly(snapshot.baseSalary);
  const allowances = annualToMonthly(snapshot.allowances);
  const { id, employeeCode, firstName, lastName } = employee;
  return {
    employee: { id, employeeCode, firstName, lastName },
    month,
    periodStart,
    periodEnd,
    jobTitle: snapshot.jobTitle,
    department: snapshot.department,
    countryCode: snapshot.countryCode,
    countryName: snapshot.countryName,
    currencyCode: snapshot.currencyCode,
    status: employeeStatus(employee.lastWorkingDay, today),
    lastWorkingDay: employee.lastWorkingDay,
    earnings: [
      { label: 'Base salary', amount: base },
      { label: 'Allowances', amount: allowances },
    ],
    // Sum of the rounded lines, so the slip always adds up.
    grossPay: addAmounts(base, allowances),
    notice: 'Gross pay only. Statutory deductions are not calculated.',
  };
}

export type Slip = ReturnType<typeof buildSlip>;
