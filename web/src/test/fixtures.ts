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
