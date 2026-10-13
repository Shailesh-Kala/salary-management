import { spreadsheetSafe } from '../../lib/spreadsheet-safe.ts';
import type { EmployeeListItem } from '../employees/employees.repository.ts';

/** The import template's columns, then status, last working day and converted annual salary. */
export const exportHeader = (currency: string) => [
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
  `annual_salary_${currency.toLowerCase()}`,
];

const textCells = (e: EmployeeListItem) =>
  [e.employeeCode, e.firstName, e.lastName, e.email, e.jobTitle, e.department, e.countryCode].map(
    spreadsheetSafe,
  );

export const csvRow = (e: EmployeeListItem) => [
  ...textCells(e),
  e.hireDate,
  e.baseSalary,
  e.allowances,
  e.currencyCode,
  e.status,
  e.lastWorkingDay ?? '',
  e.convertedAnnualSalary,
];

const asDate = (date: string | null) => (date ? new Date(`${date}T00:00:00Z`) : null);

/** Typed cells: amounts as numbers and dates as dates, so Excel can sort, sum and pivot them. */
export const xlsxRow = (e: EmployeeListItem) => [
  ...textCells(e),
  asDate(e.hireDate),
  Number(e.baseSalary),
  Number(e.allowances),
  e.currencyCode,
  e.status,
  asDate(e.lastWorkingDay),
  Number(e.convertedAnnualSalary),
];

/** 1-based column numbers in the sheet, for formats. */
export const DATE_COLUMNS = [8, 13];
export const AMOUNT_COLUMNS = [9, 10, 14];
