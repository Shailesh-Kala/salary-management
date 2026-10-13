import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { employeeDetail, FILTER_OPTIONS, historyEntry, USER } from '../test/fixtures.ts';
import { json, mockApi, renderAt } from '../test/render.tsx';

const slip = (month: string, overrides: object = {}) => ({
  employee: { id: 'e1', employeeCode: 'EMP-00001', firstName: 'Asha', lastName: 'Verma' },
  month,
  periodStart: `${month}-01`,
  periodEnd: `${month}-30`,
  jobTitle: 'Software Engineer',
  department: 'Engineering',
  countryCode: 'IN',
  countryName: 'India',
  currencyCode: 'INR',
  status: 'active',
  lastWorkingDay: null,
  earnings: [
    { label: 'Base salary', amount: '150000.00' },
    { label: 'Allowances', amount: '16666.67' },
  ],
  grossPay: '166666.67',
  notice: 'Gross pay only. Statutory deductions are not calculated.',
  ...overrides,
});

function setup(path: string) {
  const months: string[] = [];
  mockApi({
    'GET /api/auth/me': () => json(200, { user: USER }),
    'GET /api/employees/filter-options': () => json(200, FILTER_OPTIONS),
    'GET /api/employees/e1': () => json(200, employeeDetail()),
    'GET /api/employees/e1/changes': () => json(200, { items: [historyEntry()] }),
    'GET /api/employees/e1/slips/2026-09': () => {
      months.push('2026-09');
      return json(200, slip('2026-09'));
    },
    'GET /api/employees/e1/slips/2026-08': () => {
      months.push('2026-08');
      return json(
        200,
        slip('2026-08', {
          currencyCode: 'USD',
          countryName: 'United States',
          grossPay: '13333.33',
          earnings: [
            { label: 'Base salary', amount: '12500.00' },
            { label: 'Allowances', amount: '833.33' },
          ],
        }),
      );
    },
    'GET /api/employees/e1/slips/2024-03': () =>
      json(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          details: [{ path: 'month', message: 'Asha Verma joined on 2024-04-01' }],
        },
      }),
  });
  renderAt(path);
  return months;
}

describe('salary slip page', () => {
  it('shows the earnings in the slip currency, the gross pay and the gross-only notice', async () => {
    setup('/employees/e1/slip?month=2026-09');

    expect(await screen.findByRole('heading', { name: 'Salary slip' })).toBeInTheDocument();
    expect(screen.getByText('September 2026 (2026-09-01 to 2026-09-30)')).toBeInTheDocument();
    expect(screen.getByText('Asha Verma (EMP-00001)')).toBeInTheDocument();
    expect(screen.getByText('₹1,50,000.00')).toBeInTheDocument();
    expect(screen.getByText('₹16,666.67')).toBeInTheDocument();
    expect(screen.getByText('₹1,66,666.67')).toBeInTheDocument();
    expect(
      screen.getByText('Gross pay only. Statutory deductions are not calculated.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /download pdf/i })).toHaveAttribute(
      'href',
      '/api/employees/e1/slips/2026-09?format=pdf',
    );
    expect(screen.getByRole('button', { name: /print/i })).toBeInTheDocument();
  });

  it('loads another month, in that month’s currency, and keeps it in the URL', async () => {
    const months = setup('/employees/e1/slip?month=2026-09');
    await screen.findByText('₹1,66,666.67');

    fireEvent.change(screen.getByLabelText(/month/i), { target: { value: '2026-08' } });

    expect(await screen.findByText('$13,333.33')).toBeInTheDocument();
    expect(months).toEqual(['2026-09', '2026-08']);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('month=2026-08'));
  });

  it('explains why there is no slip for a month', async () => {
    setup('/employees/e1/slip?month=2024-03');

    expect(await screen.findByRole('alert')).toHaveTextContent('Asha Verma joined on 2024-04-01');
    expect(screen.queryByRole('link', { name: /download pdf/i })).not.toBeInTheDocument();
  });

  it('is opened from the employee page', async () => {
    setup('/employees/e1');

    await userEvent
      .setup({ delay: null })
      .click(await screen.findByRole('link', { name: /salary slip/i }));

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/employees\/e1\/slip/),
    );
  });
});
