import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { json, mockApi, renderAt } from '../test/render.tsx';

const USER = { id: 'u1', email: 'hr@acme.local', name: 'HR Manager' };

const employee = (overrides: object) => ({
  id: 'e1',
  employeeCode: 'EMP-001',
  firstName: 'Asha',
  lastName: 'Verma',
  email: 'asha.verma@acme.com',
  jobTitle: 'Software Engineer',
  department: 'Engineering',
  countryCode: 'IN',
  currencyCode: 'INR',
  hireDate: '2024-04-01',
  baseSalary: '1800000.00',
  allowances: '200000.00',
  annualSalary: '2000000.00',
  convertedAnnualSalary: '2000000.00',
  status: 'active',
  lastWorkingDay: null,
  ...overrides,
});

const OPTIONS = {
  countries: [
    { code: 'IN', name: 'India', currencyCode: 'INR' },
    { code: 'US', name: 'United States', currencyCode: 'USD' },
  ],
  departments: ['Engineering', 'Sales'],
  jobTitles: ['Software Engineer'],
  currencies: ['INR', 'USD'],
};

function setup(path = '/employees', listResponse?: () => Response) {
  const queries: Record<string, string>[] = [];
  mockApi({
    'GET /api/auth/me': () => json(200, { user: USER }),
    'GET /api/employees/filter-options': () => json(200, OPTIONS),
    'GET /api/employees': (url) => {
      queries.push(Object.fromEntries(url.searchParams));
      if (listResponse) return listResponse();
      const currency = url.searchParams.get('currency') ?? 'INR';
      return json(200, {
        items: [
          employee({}),
          employee({
            id: 'e2',
            employeeCode: 'EMP-004',
            firstName: 'Dev',
            lastName: 'Patel',
            status: 'on_notice',
            lastWorkingDay: '2026-11-30',
          }),
        ],
        total: 60,
        page: Number(url.searchParams.get('page')),
        pageSize: 25,
        currency,
        ratesAsOf: '2026-10-01',
      });
    },
  });
  renderAt(path);
  return { lastQuery: () => queries.at(-1), queries };
}

const user = () => userEvent.setup();
const location = () => screen.getByTestId('location');

async function choose(label: string, option: string) {
  await user().click(await screen.findByRole('combobox', { name: label }));
  await user().click(
    within(await screen.findByRole('listbox')).getByRole('option', { name: option }),
  );
}

describe('employees list page', () => {
  it('loads page 1 sorted by name in INR and shows rows, total, status and rates date', async () => {
    const { lastQuery } = setup();

    expect(await screen.findByText('Asha Verma')).toBeInTheDocument();
    expect(lastQuery()).toEqual({
      page: '1',
      pageSize: '25',
      sort: 'name',
      order: 'asc',
      currency: 'INR',
    });
    expect(screen.getByText('60 employees')).toBeInTheDocument();
    expect(screen.getByText(/rates as of 2026-10-01/i)).toBeInTheDocument();
    expect(screen.getByText('On notice')).toBeInTheDocument();
    expect(screen.getAllByText('₹20,00,000.00').length).toBeGreaterThan(0);
  });

  it('filters by country from page 1 and keeps the state in the URL', async () => {
    const { lastQuery } = setup('/employees?page=3');
    await screen.findByText('Asha Verma');
    expect(lastQuery()).toMatchObject({ page: '3' });

    await choose('Country', 'India');

    await waitFor(() => expect(lastQuery()).toMatchObject({ country: 'IN', page: '1' }));
    expect(location()).toHaveTextContent('country=IN');
  });

  it('filters by department, job title and status', async () => {
    const { lastQuery } = setup();
    await screen.findByText('Asha Verma');

    await choose('Department', 'Sales');
    await choose('Job title', 'Software Engineer');
    await choose('Status', 'On notice');

    await waitFor(() =>
      expect(lastQuery()).toMatchObject({
        department: 'Sales',
        jobTitle: 'Software Engineer',
        status: 'on_notice',
      }),
    );
  });

  it('searches once typing pauses, not on every keystroke', async () => {
    const { queries } = setup();
    await screen.findByText('Asha Verma');

    await user().type(screen.getByRole('textbox', { name: /search/i }), 'asha');

    await waitFor(() => expect(queries.at(-1)).toMatchObject({ q: 'asha', page: '1' }));
    expect(queries.filter((q) => q.q).map((q) => q.q)).toEqual(['asha']);
  });

  it('sorts by converted annual salary from the column header', async () => {
    const { lastQuery } = setup();
    await screen.findByText('Asha Verma');

    await user().click(screen.getByText('Annual salary (INR)'));
    await waitFor(() => expect(lastQuery()).toMatchObject({ sort: 'annualSalary', order: 'asc' }));

    await user().click(screen.getByText('Annual salary (INR)'));
    await waitFor(() => expect(lastQuery()).toMatchObject({ sort: 'annualSalary', order: 'desc' }));
  });

  it('moves to the next page', async () => {
    const { lastQuery } = setup();
    await screen.findByText('Asha Verma');

    await user().click(screen.getByRole('button', { name: /next page/i }));

    await waitFor(() => expect(lastQuery()).toMatchObject({ page: '2' }));
  });

  it('shows salaries in the chosen currency', async () => {
    const { lastQuery } = setup();
    await screen.findByText('Asha Verma');

    await choose('Currency', 'USD');

    await waitFor(() => expect(lastQuery()).toMatchObject({ currency: 'USD' }));
    expect(await screen.findByText('Annual salary (USD)')).toBeInTheDocument();
  });

  it('sends the user to login when the session has expired', async () => {
    setup('/employees?country=IN', () =>
      json(401, { error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }),
    );

    await waitFor(() =>
      expect(location()).toHaveTextContent(
        `/login?next=${encodeURIComponent('/employees?country=IN')}`,
      ),
    );
  });
});
