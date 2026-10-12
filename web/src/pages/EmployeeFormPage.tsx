import {
  Alert,
  Box,
  Button,
  MenuItem,
  Paper,
  Stack,
  TextField,
  type TextFieldProps,
  Typography,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, ApiError } from '../api/client.ts';
import { type EmployeeDetail, fieldErrors, useFilterOptions } from '../api/employees.ts';

const EMPTY = {
  employeeCode: '',
  firstName: '',
  lastName: '',
  email: '',
  jobTitle: '',
  department: '',
  countryCode: '',
  hireDate: '',
  baseSalary: '',
  allowances: '',
};

type Form = typeof EMPTY;

export function EmployeeFormPage() {
  const [form, setForm] = useState(EMPTY);
  const options = useFilterOptions();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const create = useMutation({
    // Blank optional fields are left out so the server applies its defaults.
    mutationFn: (values: Form) =>
      api<EmployeeDetail>('/employees', {
        method: 'POST',
        body: Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== '')),
      }),
    onSuccess: (employee) => {
      queryClient.setQueryData(['employee', employee.id], employee);
      void queryClient.invalidateQueries({ queryKey: ['employees'] });
      void queryClient.invalidateQueries({ queryKey: ['employee-filter-options'] });
      navigate(`/employees/${employee.id}`);
    },
  });

  const errors = fieldErrors(create.error);
  const currency = options.data?.countries.find((c) => c.code === form.countryCode)?.currencyCode;
  const field = (name: keyof Form, label: string, props: TextFieldProps = {}) => (
    <TextField
      label={label}
      value={form[name]}
      onChange={(e) => setForm({ ...form, [name]: e.target.value })}
      error={Boolean(errors[name])}
      helperText={errors[name]}
      required
      fullWidth
      {...props}
    />
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(form);
  };
  const generalError =
    create.error instanceof ApiError && Object.keys(errors).length === 0
      ? create.error.message
      : null;

  return (
    <Stack spacing={2} sx={{ maxWidth: 720 }}>
      <Button component={Link} to="/employees" sx={{ alignSelf: 'flex-start' }}>
        ← Employees
      </Button>
      <Typography variant="h4" component="h1">
        Add employee
      </Typography>
      <Paper component="form" onSubmit={submit} sx={{ p: 3 }} noValidate>
        <Stack spacing={2}>
          {generalError && <Alert severity="error">{generalError}</Alert>}
          {field('employeeCode', 'Employee code', { placeholder: 'EMP-00001' })}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            {field('firstName', 'First name')}
            {field('lastName', 'Last name')}
          </Stack>
          {field('email', 'Work email', { type: 'email' })}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            {field('jobTitle', 'Job title')}
            {field('department', 'Department')}
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            {field('countryCode', 'Country', {
              select: true,
              children: (options.data?.countries ?? []).map((c) => (
                <MenuItem key={c.code} value={c.code}>
                  {c.name}
                </MenuItem>
              )),
            })}
            {field('hireDate', 'Hire date', {
              type: 'date',
              slotProps: { inputLabel: { shrink: true } },
            })}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {currency
              ? `Annual amounts in ${currency} (the country's currency)`
              : 'Choose a country to set the currency'}
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            {field('baseSalary', 'Base salary', {
              slotProps: { htmlInput: { inputMode: 'decimal' } },
            })}
            {field('allowances', 'Allowances', {
              required: false,
              slotProps: { htmlInput: { inputMode: 'decimal' } },
            })}
          </Stack>
          <Box>
            <Button type="submit" variant="contained" disabled={create.isPending}>
              Create employee
            </Button>
          </Box>
        </Stack>
      </Paper>
    </Stack>
  );
}
