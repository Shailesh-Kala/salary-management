import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../api/client.ts';
import {
  type EmployeeDetail,
  EXIT_TYPE_LABELS,
  type HistoryEntry,
  saveErrors,
  useFilterOptions,
} from '../api/employees.ts';
import { ChangeDialog } from '../components/ChangeDialog.tsx';
import { ExitDialog } from '../components/ExitDialog.tsx';
import { HistoryList } from '../components/HistoryList.tsx';
import { StatusChip } from '../components/StatusChip.tsx';
import { VersionConflictAlert } from '../components/VersionConflictAlert.tsx';
import { WithdrawExitDialog } from '../components/WithdrawExitDialog.tsx';
import { daysBetween } from '../lib/dates.ts';
import { formatMoney } from '../lib/format.ts';

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack direction="row" spacing={2}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 140 }}>
        {label}
      </Typography>
      <Typography variant="body2">{children}</Typography>
    </Stack>
  );
}

function EditProfileDialog({
  employee,
  onClose,
}: {
  employee: EmployeeDetail;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    firstName: employee.firstName,
    lastName: employee.lastName,
    email: employee.email,
  });
  const save = useMutation({
    // Sends the version this form was loaded with; the server refuses it if someone saved since.
    mutationFn: () =>
      api<EmployeeDetail>(`/employees/${employee.id}`, {
        method: 'PATCH',
        body: { version: employee.version, ...form },
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['employee', employee.id], updated);
      void queryClient.invalidateQueries({ queryKey: ['employees'] });
      onClose();
    },
  });

  const { conflict, general, fields: errors } = saveErrors(save.error);
  const reload = () => {
    void queryClient.invalidateQueries({ queryKey: ['employee', employee.id] });
    onClose();
  };
  const input = (name: keyof typeof form, label: string) => (
    <TextField
      label={label}
      value={form[name]}
      onChange={(e) => setForm({ ...form, [name]: e.target.value })}
      error={Boolean(errors[name])}
      helperText={errors[name]}
      fullWidth
    />
  );

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Edit profile</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {conflict ? (
            <VersionConflictAlert onReload={reload} />
          ) : (
            general && <Alert severity="error">{general}</Alert>
          )}
          {input('firstName', 'First name')}
          {input('lastName', 'Last name')}
          {input('email', 'Work email')}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => save.mutate()} disabled={save.isPending}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function EmployeeDetailPage() {
  const { id } = useParams();
  const [dialog, setDialog] = useState<'profile' | 'change' | 'exit' | 'withdraw' | null>(null);
  const employee = useQuery({
    queryKey: ['employee', id],
    queryFn: () => api<EmployeeDetail>(`/employees/${id}`),
  });
  const history = useQuery({
    queryKey: ['employee-history', id],
    queryFn: () => api<{ items: HistoryEntry[] }>(`/employees/${id}/changes`),
  });
  const countries = useFilterOptions().data?.countries ?? [];

  if (employee.isPending) return <CircularProgress aria-label="Loading employee" />;
  if (employee.isError) return <Alert severity="error">{employee.error.message}</Alert>;

  const e = employee.data;
  const money = (amount: string) => formatMoney(amount, e.currencyCode);
  const annual = String(Number(e.baseSalary) + Number(e.allowances));

  return (
    <Stack spacing={2}>
      <Button component={Link} to="/employees" sx={{ alignSelf: 'flex-start' }}>
        ← Employees
      </Button>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        <Typography variant="h4" component="h1">
          {e.firstName} {e.lastName}
        </Typography>
        <StatusChip status={e.status} />
        <Stack direction="row" spacing={1} sx={{ ml: 'auto' }}>
          <Button variant="outlined" component={Link} to={`/employees/${e.id}/slip`}>
            Salary slip
          </Button>
          <Button variant="outlined" onClick={() => setDialog('profile')}>
            Edit profile
          </Button>
          {e.status === 'active' && (
            <Button variant="outlined" color="warning" onClick={() => setDialog('exit')}>
              Record exit
            </Button>
          )}
          {e.status === 'on_notice' && (
            <Button variant="outlined" color="warning" onClick={() => setDialog('withdraw')}>
              Withdraw exit
            </Button>
          )}
          <Button variant="contained" onClick={() => setDialog('change')}>
            Record change
          </Button>
        </Stack>
      </Stack>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <Paper sx={{ p: 3, flex: 1 }}>
          <Stack spacing={1}>
            <Typography variant="h6" component="h2">
              Profile
            </Typography>
            <Detail label="Employee code">{e.employeeCode}</Detail>
            <Detail label="Work email">{e.email}</Detail>
            <Detail label="Job title">{e.jobTitle}</Detail>
            <Detail label="Department">{e.department}</Detail>
            <Detail label="Country">{e.countryName}</Detail>
            <Detail label="Hire date">{e.hireDate}</Detail>
            {e.exitType && e.noticeDate && e.lastWorkingDay && (
              <>
                <Detail label="Exit type">{EXIT_TYPE_LABELS[e.exitType]}</Detail>
                <Detail label="Notice date">{e.noticeDate}</Detail>
                <Detail label="Last working day">{e.lastWorkingDay}</Detail>
                <Detail label="Notice period">
                  {daysBetween(e.noticeDate, e.lastWorkingDay)} days
                </Detail>
              </>
            )}
          </Stack>
        </Paper>
        <Paper sx={{ p: 3, flex: 1 }}>
          <Stack spacing={1}>
            <Typography variant="h6" component="h2">
              Current pay
            </Typography>
            <Detail label="Base salary">{money(e.baseSalary)}</Detail>
            <Detail label="Allowances">{money(e.allowances)}</Detail>
            <Detail label="Annual total">{money(annual)}</Detail>
            <Typography variant="caption" color="text.secondary">
              Annual amounts in {e.currencyCode}
            </Typography>
          </Stack>
        </Paper>
      </Stack>

      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" component="h2">
          History
        </Typography>
        {history.isError && <Alert severity="error">{history.error.message}</Alert>}
        {history.data && <HistoryList entries={history.data.items} countries={countries} />}
      </Paper>

      {dialog === 'profile' && <EditProfileDialog employee={e} onClose={() => setDialog(null)} />}
      {dialog === 'exit' && <ExitDialog employee={e} onClose={() => setDialog(null)} />}
      {dialog === 'withdraw' && <WithdrawExitDialog employee={e} onClose={() => setDialog(null)} />}
      {dialog === 'change' && (
        <ChangeDialog employee={e} countries={countries} onClose={() => setDialog(null)} />
      )}
    </Stack>
  );
}
