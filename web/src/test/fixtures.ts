export const USER = { id: 'u1', email: 'hr@acme.local', name: 'HR Manager' };

export const FILTER_OPTIONS = {
  countries: [
    { code: 'IN', name: 'India', currencyCode: 'INR' },
    { code: 'US', name: 'United States', currencyCode: 'USD' },
  ],
  departments: ['Engineering', 'Sales'],
  jobTitles: ['Software Engineer'],
  currencies: ['INR', 'USD'],
};

export const employeeDetail = (overrides: object = {}) => ({
  id: 'e1',
  employeeCode: 'EMP-00001',
  firstName: 'Asha',
  lastName: 'Verma',
  email: 'asha.verma@acme.com',
  jobTitle: 'Software Engineer',
  department: 'Engineering',
  countryCode: 'IN',
  countryName: 'India',
  currencyCode: 'INR',
  hireDate: '2024-04-01',
  baseSalary: '1800000.00',
  allowances: '200000.00',
  exitType: null,
  noticeDate: null,
  lastWorkingDay: null,
  status: 'active',
  version: 1,
  ...overrides,
});

export const historyEntry = (overrides: object = {}) => ({
  id: '1',
  changeType: 'hire',
  effectiveDate: '2024-04-01',
  note: 'Employee record created',
  source: 'ui',
  changes: {
    baseSalary: { old: null, new: '1800000.00' },
    jobTitle: { old: null, new: 'Software Engineer' },
  },
  snapshot: {
    baseSalary: '1800000.00',
    allowances: '200000.00',
    currencyCode: 'INR',
    countryCode: 'IN',
    jobTitle: 'Software Engineer',
    department: 'Engineering',
  },
  changedBy: { id: 'u1', name: 'HR Manager' },
  changedAt: '2024-04-01T09:00:00.000Z',
  ...overrides,
});
