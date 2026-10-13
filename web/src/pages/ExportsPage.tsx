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
import { Link } from 'react-router';
import { api } from '../api/client.ts';

type EmailedExport = {
  id: string;
  status: 'queued' | 'ready' | 'failed';
  rowCount: number;
  createdAt: string;
  expiresAt: string | null;
  deletedAt: string | null;
  error: string | null;
};

/** What HR sees for an export: a ready one is only openable until its link expires. */
function stateOf(e: EmailedExport) {
  if (e.status === 'queued') return { label: 'Being prepared', openable: false };
  if (e.status === 'failed') return { label: 'Failed', openable: false };
  const expired = e.deletedAt !== null || new Date(e.expiresAt!) <= new Date();
  return expired ? { label: 'Expired', openable: false } : { label: 'Ready', openable: true };
}

const when = (iso: string) => new Date(iso).toLocaleString('en-IN');

export function ExportsPage() {
  const exports = useQuery({
    queryKey: ['exports'],
    queryFn: () => api<{ items: EmailedExport[] }>('/exports'),
    // While one is being prepared, check back until it is ready.
    refetchInterval: (q) => (q.state.data?.items.some((e) => e.status === 'queued') ? 5000 : false),
  });

  return (
    <Stack spacing={2}>
      <Typography variant="h4" component="h1">
        My exports
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Large PDFs are built in the background and a link is emailed to you. The link works for 24
        hours, and only for you.
      </Typography>
      {exports.isError && <Alert severity="error">{exports.error.message}</Alert>}
      {exports.data?.items.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          No emailed exports yet.
        </Typography>
      )}
      {Boolean(exports.data?.items.length) && (
        <Paper>
          <Table aria-label="My exports" size="small">
            <TableHead>
              <TableRow>
                <TableCell>Requested</TableCell>
                <TableCell align="right">Employees</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Link expires</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {exports.data?.items.map((e) => {
                const { label, openable } = stateOf(e);
                return (
                  <TableRow key={e.id}>
                    <TableCell>{when(e.createdAt)}</TableCell>
                    <TableCell align="right">{e.rowCount.toLocaleString('en-IN')}</TableCell>
                    <TableCell>
                      {label}
                      {e.error && (
                        <Typography variant="caption" color="error" sx={{ display: 'block' }}>
                          {e.error}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>{e.expiresAt ? when(e.expiresAt) : '—'}</TableCell>
                    <TableCell align="right">
                      {openable && (
                        <MuiLink component={Link} to={`/exports/${e.id}`}>
                          Open
                        </MuiLink>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Paper>
      )}
    </Stack>
  );
}
