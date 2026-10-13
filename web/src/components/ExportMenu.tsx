import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link as MuiLink,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, ApiError, download } from '../api/client.ts';
import { useMe } from '../auth/session.ts';

const FORMATS = [
  { label: 'CSV', format: 'csv' },
  { label: 'Excel', format: 'xlsx' },
  { label: 'PDF', format: 'pdf' },
];

type TooLarge = { rowCount: number; limit: number };

const count = (n: number) => n.toLocaleString('en-IN');

/** Offers to build a PDF that is too big to download now, and email a link to the requester. */
function EmailDialog({
  tooLarge,
  filters,
  onClose,
}: {
  tooLarge: TooLarge;
  filters: Record<string, string>;
  onClose: () => void;
}) {
  const me = useMe();
  const queue = useMutation({
    mutationFn: () => api('/exports/employees/email', { method: 'POST', body: filters }),
  });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>This PDF is too large to download now</DialogTitle>
      <DialogContent>
        {queue.isError && <Alert severity="error">{queue.error.message}</Alert>}
        {queue.isSuccess ? (
          <Typography>
            We are preparing your PDF. When it is ready, a link will be emailed to {me.data?.email}.
            The link works for 24 hours. You can also find it under{' '}
            <MuiLink component={Link} to="/exports">
              My exports
            </MuiLink>
            .
          </Typography>
        ) : (
          <Typography>
            This list has {count(tooLarge.rowCount)} employees, but a PDF can hold up to{' '}
            {count(tooLarge.limit)}. You can narrow the filters, download CSV or Excel, or have the
            full PDF built in the background and a link to it emailed to {me.data?.email}.
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        {queue.isSuccess ? (
          <Button onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="contained" onClick={() => queue.mutate()} disabled={queue.isPending}>
              Email me the PDF
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
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
  const [tooLarge, setTooLarge] = useState<TooLarge | null>(null);

  const exportAs = async (format: string) => {
    setAnchor(null);
    onError(null);
    setBusy(true);
    try {
      await download(
        `/exports/employees?${new URLSearchParams({ format, ...Object.fromEntries(query) })}`,
      );
    } catch (error) {
      if (error instanceof ApiError && error.code === 'EXPORT_TOO_LARGE') {
        setTooLarge(error.details as TooLarge);
      } else {
        onError(error instanceof Error ? error.message : 'Export failed');
      }
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
      {tooLarge && (
        <EmailDialog
          tooLarge={tooLarge}
          filters={Object.fromEntries(query)}
          onClose={() => setTooLarge(null)}
        />
      )}
    </>
  );
}
