import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { employeeDetail, FILTER_OPTIONS, USER } from '../test/fixtures.ts';
import { json, mockApi, renderAt } from '../test/render.tsx';

const user = () => userEvent.setup({ delay: null });

function setup(createResponse: () => Response) {
  const posted: unknown[] = [];
  mockApi({
    'GET /api/auth/me': () => json(200, { user: USER }),
    'GET /api/employees/filter-options': () => json(200, FILTER_OPTIONS),
    'GET /api/employees/e-new': () => json(200, employeeDetail({ id: 'e-new' })),
    'POST /api/employees': (_url, body) => {
      posted.push(body);
      return createResponse();
    },
  });
  renderAt('/employees/new');
  return { posted };
}

async function fillForm() {
  const field = (name: RegExp) => screen.getByRole('textbox', { name });
  await user().type(await screen.findByRole('textbox', { name: /employee code/i }), 'EMP-00001');
  await user().type(field(/first name/i), 'Asha');
  await user().type(field(/last name/i), 'Verma');
  await user().type(field(/email/i), 'asha.verma@acme.com');
  await user().type(field(/job title/i), 'Software Engineer');
  await user().type(field(/department/i), 'Engineering');
  await user().click(screen.getByRole('combobox', { name: /country/i }));
  await user().click(
    within(await screen.findByRole('listbox')).getByRole('option', { name: 'India' }),
  );
  await user().type(screen.getByLabelText(/hire date/i), '2024-04-01');
  await user().type(field(/base salary/i), '1800000');
  await user().type(field(/allowances/i), '200000');
}

describe('create employee page', () => {
  it('posts the form, then opens the new employee', async () => {
    const { posted } = setup(() => json(201, employeeDetail({ id: 'e-new' })));

    await fillForm();
    expect(screen.getByText(/amounts in INR/i)).toBeInTheDocument();
    await user().click(screen.getByRole('button', { name: /create employee/i }));

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/employees/e-new'),
    );
    expect(posted).toEqual([
      {
        employeeCode: 'EMP-00001',
        firstName: 'Asha',
        lastName: 'Verma',
        email: 'asha.verma@acme.com',
        jobTitle: 'Software Engineer',
        department: 'Engineering',
        countryCode: 'IN',
        hireDate: '2024-04-01',
        baseSalary: '1800000',
        allowances: '200000',
      },
    ]);
  });

  it('says what is missing and sends nothing when you submit an empty form', async () => {
    const { posted } = setup(() => json(201, employeeDetail({ id: 'e-new' })));
    await screen.findByRole('textbox', { name: /employee code/i });

    await user().click(screen.getByRole('button', { name: /create employee/i }));

    expect(await screen.findByText('Enter an employee code, like EMP-00001')).toBeInTheDocument();
    expect(screen.getByText('Enter the first name')).toBeInTheDocument();
    expect(screen.getByText('Enter the work email')).toBeInTheDocument();
    expect(screen.getByText('Choose a country')).toBeInTheDocument();
    expect(screen.getByText('Choose the hire date')).toBeInTheDocument();
    expect(screen.getByText('Enter the annual base salary')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/received undefined|Invalid input/);
    expect(posted).toEqual([]);
  });

  it('explains a badly typed email and amount, and clears each message once you edit the field', async () => {
    const { posted } = setup(() => json(201, employeeDetail({ id: 'e-new' })));
    await fillForm();
    const email = screen.getByRole('textbox', { name: /email/i });
    await user().clear(email);
    await user().type(email, 'asha.verma');
    const salary = screen.getByRole('textbox', { name: /base salary/i });
    await user().clear(salary);
    await user().type(salary, '1,800,000');

    await user().click(screen.getByRole('button', { name: /create employee/i }));

    expect(
      await screen.findByText('Enter a valid email address, like name@company.com'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Enter a plain number like 95000 or 95000.50, with no commas or currency symbols',
      ),
    ).toBeInTheDocument();
    expect(posted).toEqual([]);

    await user().type(email, '@acme.com');

    expect(
      screen.queryByText('Enter a valid email address, like name@company.com'),
    ).not.toBeInTheDocument();
  });

  it('shows server validation errors next to the fields', async () => {
    setup(() =>
      json(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          details: [{ path: 'hireDate', message: 'Hire date cannot be in the future' }],
        },
      }),
    );

    await fillForm();
    await user().click(screen.getByRole('button', { name: /create employee/i }));

    expect(await screen.findByText('Hire date cannot be in the future')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/employees/new');
  });

  it('shows a duplicate employee code on the code field', async () => {
    setup(() =>
      json(409, {
        error: {
          code: 'DUPLICATE',
          message: 'Another record already has this employeeCode',
          details: [{ path: 'employeeCode', message: 'Already in use' }],
        },
      }),
    );

    await fillForm();
    await user().click(screen.getByRole('button', { name: /create employee/i }));

    const code = screen.getByRole('textbox', { name: /employee code/i });
    await waitFor(() => expect(code).toHaveAccessibleDescription('Already in use'));
  });
});
