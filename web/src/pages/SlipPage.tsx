import {
  Alert,
  Button,
  CircularProgress,
  Divider,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { api } from '../api/client.ts';
import { fieldErrors } from '../api/employees.ts';
import { formatMoney } from '../lib/format.ts';

type Slip = {
  employee: { id: string; employeeCode: string; firstName: string; lastName: string };
  month: string;
  periodStart: string;
  periodEnd: string;
  jobTitle: string;
  department: string;
  countryName: string;
  currencyCode: string;
  lastWorkingDay: string | null;
  earnings: { label: string; amount: string }[];
  grossPay: string;
  notice: string;
};

/** The last completed month in the viewer's calendar, a sensible default for a slip. */
function previousMonth() {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

const monthLabel = (month: string) =>
  new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    Date.parse(`${month}-01T00:00:00Z`),
  );

function Line({ label, value, bold }: { label: string; value: ReactNode; bold?: boolean }) {
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
      <Typography variant="body2" sx={{ fontWeight: bold ? 700 : 400 }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: bold ? 700 : 400 }}>
        {value}
      </Typography>
    </Stack>
  );
}

export function SlipPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const month = params.get('month') ?? previousMonth();
  const slip = useQuery({
    queryKey: ['slip', id, month],
    queryFn: () => api<Slip>(`/employees/${id}/slips/${month}`),
  });

  const s = slip.data;
  const money = (amount: string) => formatMoney(amount, s!.currencyCode);

  return (
    <Stack spacing={2} sx={{ maxWidth: 720 }}>
      {/* Controls are hidden when printing, so the printout is just the slip. */}
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', displayPrint: 'none' }}>
        <Button component={Link} to={`/employees/${id}`}>
          ← Employee
        </Button>
        <TextField
          label="Month"
          type="month"
          size="small"
          value={month}
          onChange={(e) => e.target.value && setParams({ month: e.target.value })}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        {s && (
          <>
            <Button variant="outlined" onClick={() => window.print()}>
              Print
            </Button>
            <Button
              variant="contained"
              component="a"
              href={`/api/employees/${id}/slips/${month}?format=pdf`}
            >
              Download PDF
            </Button>
          </>
        )}
      </Stack>

      {slip.isPending && <CircularProgress aria-label="Loading slip" />}
      {slip.isError && (
        <Alert severity="warning">{fieldErrors(slip.error).month ?? slip.error.message}</Alert>
      )}

      {s && (
        <Paper sx={{ p: 4 }}>
          <Stack spacing={1.5}>
            <Typography variant="h4" component="h1">
              Salary slip
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {monthLabel(s.month)} ({s.periodStart} to {s.periodEnd})
            </Typography>
            <Divider />
            <Line
              label="Employee"
              value={`${s.employee.firstName} ${s.employee.lastName} (${s.employee.employeeCode})`}
            />
            <Line label="Job title" value={s.jobTitle} />
            <Line label="Department" value={s.department} />
            <Line label="Country" value={s.countryName} />
            {s.lastWorkingDay && <Line label="Last working day" value={s.lastWorkingDay} />}
            <Typography variant="h6" component="h2" sx={{ pt: 2 }}>
              Earnings ({s.currencyCode})
            </Typography>
            {s.earnings.map((line) => (
              <Line key={line.label} label={line.label} value={money(line.amount)} />
            ))}
            <Divider />
            <Line label="Gross pay" value={money(s.grossPay)} bold />
            <Typography variant="caption" color="text.secondary" sx={{ pt: 2 }}>
              {s.notice}
            </Typography>
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
