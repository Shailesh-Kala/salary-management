import { List, ListItem, Stack, Typography } from '@mui/material';
import { CHANGE_TYPE_LABELS, type FilterOptions, type HistoryEntry } from '../api/employees.ts';
import { formatMoney } from '../lib/format.ts';

const FIELD_LABELS: Record<string, string> = {
  baseSalary: 'Base salary',
  allowances: 'Allowances',
  jobTitle: 'Job title',
  department: 'Department',
  countryCode: 'Country',
  hireDate: 'Hire date',
  exitType: 'Exit type',
  noticeDate: 'Notice date',
  lastWorkingDay: 'Last working day',
};

const AMOUNTS = new Set(['baseSalary', 'allowances']);

export function HistoryList({
  entries,
  countries,
}: {
  entries: HistoryEntry[];
  countries: FilterOptions['countries'];
}) {
  const country = (code: string) => countries.find((c) => c.code === code);

  const describe = (entry: HistoryEntry) => {
    // Amounts before a relocation are in the old country's currency.
    const oldCountry = entry.changes.countryCode?.old;
    const oldCurrency =
      (oldCountry && country(oldCountry)?.currencyCode) || entry.snapshot.currencyCode;
    const show = (field: string, value: string, currency: string) =>
      AMOUNTS.has(field)
        ? formatMoney(value, currency)
        : field === 'countryCode'
          ? (country(value)?.name ?? value)
          : value;

    return Object.entries(entry.changes).map(([field, { old, new: next }]) => {
      const label = FIELD_LABELS[field] ?? field;
      const after = next === null ? '—' : show(field, next, entry.snapshot.currencyCode);
      return old === null
        ? `${label}: ${after}`
        : `${label}: ${show(field, old, oldCurrency)} → ${after}`;
    });
  };

  return (
    <List aria-label="History" disablePadding>
      {entries.map((entry) => (
        <ListItem key={entry.id} divider sx={{ px: 0 }}>
          <Stack spacing={0.5}>
            <Typography variant="subtitle2">
              {CHANGE_TYPE_LABELS[entry.changeType] ?? entry.changeType} · {entry.effectiveDate}
            </Typography>
            <Typography variant="body2">{entry.note}</Typography>
            {describe(entry).map((line) => (
              <Typography key={line} variant="body2" color="text.secondary">
                {line}
              </Typography>
            ))}
            <Typography variant="caption" color="text.secondary">
              by {entry.changedBy.name}
              {entry.source !== 'ui' && ` (${entry.source})`}
            </Typography>
          </Stack>
        </ListItem>
      ))}
    </List>
  );
}
