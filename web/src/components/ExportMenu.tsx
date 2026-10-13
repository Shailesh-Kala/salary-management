import { Button, Menu, MenuItem } from '@mui/material';
import { useState } from 'react';
import { ApiError, download } from '../api/client.ts';

const FORMATS = [
  { label: 'CSV', format: 'csv' },
  { label: 'Excel', format: 'xlsx' },
  { label: 'PDF', format: 'pdf' },
];

function explain(error: unknown) {
  if (error instanceof ApiError && error.code === 'EXPORT_TOO_LARGE') {
    const { rowCount, limit } = error.details as { rowCount: number; limit: number };
    const n = (value: number) => value.toLocaleString('en-IN');
    return `This list has ${n(rowCount)} employees, but a PDF can hold up to ${n(limit)}. Narrow the filters, or download CSV or Excel.`;
  }
  return error instanceof Error ? error.message : 'Export failed';
}

/** Downloads the list in the chosen format for `query` (the list's filters, sort and currency). */
export function ExportMenu({
  query,
  onError,
}: {
  query: URLSearchParams;
  onError: (message: string | null) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);

  const exportAs = async (format: string) => {
    setAnchor(null);
    onError(null);
    setBusy(true);
    try {
      await download(
        `/exports/employees?${new URLSearchParams({ format, ...Object.fromEntries(query) })}`,
      );
    } catch (error) {
      onError(explain(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="outlined" onClick={(e) => setAnchor(e.currentTarget)} disabled={busy}>
        {busy ? 'Exporting…' : 'Export'}
      </Button>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        {FORMATS.map(({ label, format }) => (
          <MenuItem key={format} onClick={() => void exportAs(format)}>
            {label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
