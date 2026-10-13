import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FILTER_OPTIONS, USER } from '../test/fixtures.ts';
import { json, mockApi, renderAt } from '../test/render.tsx';

const user = () => userEvent.setup({ delay: null });

const stats = (v: string) => ({ min: v, median: v, average: v, max: v, total: v });

function setup(path = '/insights') {
  const requests: Record<string, Record<string, string>[]> = {};
  const record = (name: string, url: URL) => {
    (requests[name] ??= []).push(Object.fromEntries(url.searchParams));
  };
  const currencyOf = (url: URL) => url.searchParams.get('currency') ?? 'INR';
  mockApi({
    'GET /api/auth/me': () => json(200, { user: USER }),
    'GET /api/employees/filter-options': () => json(200, FILTER_OPTIONS),
    'GET /api/insights/summary': (url) => {
      record('summary', url);
      return json(200, {
        currency: currencyOf(url),
        ratesAsOf: '2026-10-01',
        headcount: 9619,
        totalPayroll: '63803716300.00',
        averageSalary: '6633093.70',
        medianSalary: '5707200.00',
      });
    },
    'GET /api/insights/by-country': (url) => {
      record('byCountry', url);
      return json(200, {
        currency: currencyOf(url),
        ratesAsOf: '2026-10-01',
        items: [
          {
            countryCode: 'US',
            countryName: 'United States',
            currencyCode: 'USD',
            headcount: 1,
            local: stats('160000.00'),
            converted: stats('14200000.00'),
          },
        ],
      });
    },
    'GET /api/insights/by-department': (url) => {
      record('byDepartment', url);
      return json(200, {
        currency: currencyOf(url),
        ratesAsOf: '2026-10-01',
        items: [
          {
            department: 'Engineering',
            headcount: 3,
            totalPayroll: '17200000.00',
            medianSalary: '2000000.00',
            averageSalary: '5733333.33',
          },
        ],
      });
    },
    'GET /api/insights/by-job-title': (url) => {
      record('byJobTitle', url);
      return json(200, {
        country: 'IN',
        currencyCode: 'INR',
        items: [
          {
            jobTitle: 'Software Engineer',
            headcount: 4,
            min: '1000000.00',
            median: '1350000.00',
            max: '3000000.00',
          },
        ],
      });
    },
    'GET /api/insights/outliers': (url) => {
      record('outliers', url);
      return json(200, {
        low: 0.8,
        high: 1.2,
        total: 1152,
        page: 1,
        pageSize: 10,
        items: [
          {
            id: 'e4',
            employeeCode: 'EMP-4',
            firstName: 'Ravi',
            lastName: 'Iyer',
            jobTitle: 'Software Engineer',
            department: 'Engineering',
            countryCode: 'IN',
            currencyCode: 'INR',
            annualSalary: '3000000.00',
            peerMedian: '1350000.00',
            peerCount: 4,
            ratio: '2.22',
            position: 'above',
          },
        ],
      });
    },
    'GET /api/insights/recent-changes': (url) => {
      record('recentChanges', url);
      return json(200, {
        from: '2026-07-14',
        to: '2026-10-12',
        total: 1,
        page: 1,
        pageSize: 10,
        items: [
          {
            id: '2',
            employeeId: 'e1',
            employeeCode: 'EMP-1',
            firstName: 'Asha',
            lastName: 'Verma',
            changeType: 'promotion',
            effectiveDate: '2026-09-01',
            note: 'Promoted',
            oldJobTitle: 'Software Engineer',
            newJobTitle: 'Senior Software Engineer',
            oldCountryCode: 'IN',
            newCountryCode: 'IN',
            oldAnnualSalary: '2000000.00',
            newAnnualSalary: '2400000.00',
            oldCurrencyCode: 'INR',
            newCurrencyCode: 'INR',
            salaryChangePercent: '20.00',
            changedBy: 'HR Manager',
          },
        ],
      });
    },
    'GET /api/insights/leavers': (url) => {
      record('leavers', url);
      return json(200, {
        currency: currencyOf(url),
        ratesAsOf: '2026-10-01',
        headcount: 294,
        totalAnnualSalary: '1886691390.00',
        byDepartment: [{ department: 'Sales', headcount: 40, totalAnnualSalary: '200000000.00' }],
        byCountry: [],
        employees: [
          {
            id: 'l1',
            employeeCode: 'L-1',
            firstName: 'Dev',
            lastName: 'Patel',
            jobTitle: 'Account Executive',
            department: 'Sales',
            countryCode: 'IN',
            exitType: 'resigned',
            lastWorkingDay: '2026-10-31',
            convertedAnnualSalary: '900000.00',
          },
        ],
      });
    },
  });
  renderAt(path);
  return requests;
}

const section = (name: RegExp) => screen.getByRole('region', { name });

describe('insights page', () => {
  it('answers each question in INR, showing the rates date', async () => {
    const requests = setup();

    expect(await screen.findByText('9,619')).toBeInTheDocument();
    expect(screen.getByText(/rates as of 2026-10-01/i)).toBeInTheDocument();
    expect(
      within(section(/headcount and payroll/i)).getByText('₹6,380,37,16,300.00'),
    ).toBeInTheDocument();
    expect(within(section(/pay by country/i)).getByText('United States')).toBeInTheDocument();
    expect(within(section(/pay by department/i)).getByText('Engineering')).toBeInTheDocument();
    expect(
      within(section(/pay range by job title/i)).getByText(/choose a country/i),
    ).toBeInTheDocument();
    const outliers = section(/outside the peer range/i);
    expect(within(outliers).getByText('Ravi Iyer')).toBeInTheDocument();
    expect(within(outliers).getByText('222%')).toBeInTheDocument();
    expect(within(outliers).getByText(/1,152 employees/)).toBeInTheDocument();
    const changes = section(/recent pay changes/i);
    expect(
      within(changes).getByText('Software Engineer → Senior Software Engineer'),
    ).toBeInTheDocument();
    expect(within(changes).getByText('+20.00%')).toBeInTheDocument();
    const leavers = section(/leaving/i);
    expect(within(leavers).getByText(/294 employees on notice/i)).toBeInTheDocument();
    expect(within(leavers).getByText('Dev Patel')).toBeInTheDocument();
    for (const name of ['summary', 'byCountry', 'byDepartment', 'leavers']) {
      expect(requests[name]?.at(-1)).toMatchObject({ currency: 'INR' });
    }
    expect(requests.byJobTitle).toBeUndefined();
  });

  it('re-queries every currency-based answer when the currency changes', async () => {
    const requests = setup();
    await screen.findByText('9,619');

    await user().click(screen.getByRole('combobox', { name: 'Currency' }));
    await user().click(
      within(await screen.findByRole('listbox')).getByRole('option', { name: 'USD' }),
    );

    await waitFor(() => {
      for (const name of ['summary', 'byCountry', 'byDepartment', 'leavers']) {
        expect(requests[name]?.at(-1)).toMatchObject({ currency: 'USD' });
      }
    });
    expect(screen.getByTestId('location')).toHaveTextContent('currency=USD');
  });

  it('filters every answer by country and shows the job-title ranges for it', async () => {
    const requests = setup();
    await screen.findByText('9,619');

    await user().click(screen.getByRole('combobox', { name: 'Country' }));
    await user().click(
      within(await screen.findByRole('listbox')).getByRole('option', { name: 'India' }),
    );

    expect(
      await within(section(/pay range by job title/i)).findByText('Software Engineer'),
    ).toBeInTheDocument();
    for (const name of [
      'summary',
      'byCountry',
      'byDepartment',
      'byJobTitle',
      'outliers',
      'recentChanges',
      'leavers',
    ]) {
      expect(requests[name]?.at(-1)).toMatchObject({ country: 'IN' });
    }
  });
});
