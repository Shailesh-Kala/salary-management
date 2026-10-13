import {
  Alert,
  Link as MuiLink,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useId } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api/client.ts';
import { CHANGE_TYPE_LABELS, useFilterOptions } from '../api/employees.ts';
import { asOptions, SelectFilter } from '../components/SelectFilter.tsx';
import { formatMoney } from '../lib/format.ts';

type Stats = { min: string; median: string; average: string; max: string; total: string };
type Rated = { currency: string; ratesAsOf: string };
type Summary = Rated & {
  headcount: number;
  totalPayroll: string;
  averageSalary: string | null;
  medianSalary: string | null;
};
type ByCountry = Rated & {
  items: {
    countryCode: string;
    countryName: string;
    currencyCode: string;
    headcount: number;
    local: Stats;
    converted: Stats;
  }[];
};
type ByDepartment = Rated & {
  items: {
    department: string;
    headcount: number;
    totalPayroll: string;
    medianSalary: string;
    averageSalary: string;
  }[];
};
type ByJobTitle = {
  currencyCode: string;
  items: { jobTitle: string; headcount: number; min: string; median: string; max: string }[];
};
type Outliers = {
  low: number;
  high: number;
  total: number;
  items: {
    id: string;
    firstName: string;
    lastName: string;
    jobTitle: string;
    countryCode: string;
    currencyCode: string;
    annualSalary: string;
    peerMedian: string;
    peerCount: number;
    ratio: string;
  }[];
};
type RecentChanges = {
  from: string;
  to: string;
  total: number;
  items: {
    id: string;
    employeeId: string;
    firstName: string;
    lastName: string;
    changeType: string;
    effectiveDate: string;
    oldJobTitle: string | null;
    newJobTitle: string;
    oldCountryCode: string | null;
    newCountryCode: string;
    salaryChangePercent: string | null;
  }[];
};
type Leavers = Rated & {
  headcount: number;
  totalAnnualSalary: string;
  employees: {
    id: string;
    firstName: string;
    lastName: string;
    department: string;
    lastWorkingDay: string;
    convertedAnnualSalary: string;
  }[];
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <Paper component="section" aria-labelledby={id} sx={{ p: 3 }}>
      <Typography id={id} variant="h6" component="h2" gutterBottom>
        {title}
      </Typography>
      {children}
    </Paper>
  );
}

function DataTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          {head.map((h) => (
            <TableCell key={h}>{h}</TableCell>
          ))}
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((cells, i) => (
          <TableRow key={i}>
            {cells.map((cell, j) => (
              <TableCell key={j}>{cell}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Stack>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h5">{value}</Typography>
    </Stack>
  );
}

const query = (values: Record<string, string>) =>
  new URLSearchParams(Object.entries(values).filter(([, v]) => v !== '')).toString();

const useInsight = <T,>(path: string, search: string, enabled = true) =>
  useQuery({
    queryKey: ['insights', path, search],
    queryFn: () => api<T>(`/insights/${path}?${search}`),
    enabled,
  });

const percentOfMedian = (ratio: string) => `${Math.round(Number(ratio) * 100)}%`;

export function InsightsPage() {
  const [params, setParams] = useSearchParams();
  const filters = {
    country: params.get('country') ?? '',
    department: params.get('department') ?? '',
    currency: params.get('currency') ?? 'INR',
  };
  const update = (key: keyof typeof filters, value: string) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });

  const options = useFilterOptions();
  const scope = { country: filters.country, department: filters.department };
  const converted = query({ ...scope, currency: filters.currency });
  const firstTen = query({ ...scope, pageSize: '10' });

  const summary = useInsight<Summary>('summary', converted);
  const byCountry = useInsight<ByCountry>('by-country', converted);
  const byDepartment = useInsight<ByDepartment>('by-department', converted);
  // Pay ranges by title only make sense within one country (one currency).
  const byJobTitle = useInsight<ByJobTitle>('by-job-title', query(scope), filters.country !== '');
  const outliers = useInsight<Outliers>('outliers', firstTen);
  const recent = useInsight<RecentChanges>('recent-changes', firstTen);
  const leavers = useInsight<Leavers>('leavers', converted);

  const currency = summary.data?.currency ?? filters.currency;
  const money = (amount: string | null) => (amount === null ? '—' : formatMoney(amount, currency));
  const failed = [summary, byCountry, byDepartment, byJobTitle, outliers, recent, leavers].find(
    (q) => q.isError,
  );

  return (
    <Stack spacing={2}>
      <Typography variant="h4" component="h1">
        Pay insights
      </Typography>
      <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <SelectFilter
          label="Country"
          allLabel="All countries"
          value={filters.country}
          options={(options.data?.countries ?? []).map((c) => ({ value: c.code, label: c.name }))}
          onChange={(v) => update('country', v)}
        />
        <SelectFilter
          label="Department"
          allLabel="All departments"
          value={filters.department}
          options={asOptions(options.data?.departments)}
          onChange={(v) => update('department', v)}
        />
        <SelectFilter
          label="Currency"
          value={filters.currency}
          options={asOptions(options.data?.currencies ?? [filters.currency])}
          onChange={(v) => update('currency', v)}
        />
        {summary.data && (
          <Typography variant="body2" color="text.secondary">
            Current staff (active and on notice). Converted figures use rates as of{' '}
            {summary.data.ratesAsOf}.
          </Typography>
        )}
      </Stack>
      {failed?.error && <Alert severity="error">{failed.error.message}</Alert>}

      <Section title="Headcount and payroll">
        {summary.data && (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={4}>
            <Stat label="Headcount" value={summary.data.headcount.toLocaleString('en-IN')} />
            <Stat label="Total annual payroll" value={money(summary.data.totalPayroll)} />
            <Stat label="Average salary" value={money(summary.data.averageSalary)} />
            <Stat label="Median salary" value={money(summary.data.medianSalary)} />
          </Stack>
        )}
      </Section>

      <Section title="Pay by country">
        <DataTable
          head={[
            'Country',
            'Headcount',
            'Median (local)',
            'Range (local)',
            `Median (${currency})`,
            `Total (${currency})`,
          ]}
          rows={(byCountry.data?.items ?? []).map((c) => [
            c.countryName,
            c.headcount,
            formatMoney(c.local.median, c.currencyCode),
            `${formatMoney(c.local.min, c.currencyCode)} – ${formatMoney(c.local.max, c.currencyCode)}`,
            money(c.converted.median),
            money(c.converted.total),
          ])}
        />
      </Section>

      <Section title="Pay by department">
        <DataTable
          head={['Department', 'Headcount', `Total (${currency})`, 'Median', 'Average']}
          rows={(byDepartment.data?.items ?? []).map((d) => [
            d.department,
            d.headcount,
            money(d.totalPayroll),
            money(d.medianSalary),
            money(d.averageSalary),
          ])}
        />
      </Section>

      <Section title="Pay range by job title">
        {filters.country === '' ? (
          <Typography variant="body2" color="text.secondary">
            Choose a country to see pay ranges by job title (in that country's currency).
          </Typography>
        ) : (
          <DataTable
            head={['Job title', 'Headcount', 'Min', 'Median', 'Max']}
            rows={(byJobTitle.data?.items ?? []).map((t) => [
              t.jobTitle,
              t.headcount,
              formatMoney(t.min, byJobTitle.data!.currencyCode),
              formatMoney(t.median, byJobTitle.data!.currencyCode),
              formatMoney(t.max, byJobTitle.data!.currencyCode),
            ])}
          />
        )}
      </Section>

      <Section title="Outside the peer range">
        {outliers.data && (
          <>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              {outliers.data.total.toLocaleString('en-IN')} employees paid outside{' '}
              {outliers.data.low * 100}–{outliers.data.high * 100}% of the median for their job
              title and country. The most extreme are shown first.
            </Typography>
            <DataTable
              head={[
                'Employee',
                'Job title',
                'Country',
                'Annual salary',
                'Peer median',
                '% of median',
                'Peers',
              ]}
              rows={outliers.data.items.map((o) => [
                <MuiLink key={o.id} component={Link} to={`/employees/${o.id}`}>
                  {o.firstName} {o.lastName}
                </MuiLink>,
                o.jobTitle,
                o.countryCode,
                formatMoney(o.annualSalary, o.currencyCode),
                formatMoney(o.peerMedian, o.currencyCode),
                percentOfMedian(o.ratio),
                o.peerCount,
              ])}
            />
          </>
        )}
      </Section>

      <Section title="Recent pay changes">
        {recent.data && (
          <>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              {recent.data.from} → {recent.data.to}: {recent.data.total.toLocaleString('en-IN')} pay
              or title changes.
            </Typography>
            <DataTable
              head={['Effective', 'Employee', 'Change', 'Job title', 'Annual pay']}
              rows={recent.data.items.map((c) => [
                c.effectiveDate,
                <MuiLink key={c.id} component={Link} to={`/employees/${c.employeeId}`}>
                  {c.firstName} {c.lastName}
                </MuiLink>,
                CHANGE_TYPE_LABELS[c.changeType] ?? c.changeType,
                c.oldJobTitle && c.oldJobTitle !== c.newJobTitle
                  ? `${c.oldJobTitle} → ${c.newJobTitle}`
                  : c.newJobTitle,
                c.salaryChangePercent !== null
                  ? `${Number(c.salaryChangePercent) >= 0 ? '+' : ''}${c.salaryChangePercent}%`
                  : `${c.oldCountryCode} → ${c.newCountryCode}`,
              ])}
            />
          </>
        )}
      </Section>

      <Section title="Leaving">
        {leavers.data && (
          <>
            <Typography variant="body2" gutterBottom>
              {leavers.data.headcount.toLocaleString('en-IN')} employees on notice, taking{' '}
              {money(leavers.data.totalAnnualSalary)} of annual pay.
            </Typography>
            <DataTable
              head={['Employee', 'Department', 'Last working day', `Annual pay (${currency})`]}
              rows={leavers.data.employees.slice(0, 10).map((l) => [
                <MuiLink key={l.id} component={Link} to={`/employees/${l.id}`}>
                  {l.firstName} {l.lastName}
                </MuiLink>,
                l.department,
                l.lastWorkingDay,
                money(l.convertedAnnualSalary),
              ])}
            />
          </>
        )}
      </Section>
    </Stack>
  );
}
