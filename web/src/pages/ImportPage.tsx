import {
  Alert,
  Button,
  LinearProgress,
  Link as MuiLink,
  List,
  ListItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, download } from '../api/client.ts';
import { CHANGE_TYPE_LABELS } from '../api/employees.ts';
import { type ImportDetails, IMPORT_STATUS_LABELS } from '../api/imports.ts';

/** While the server is working on the import, its status is checked this often. */
const POLL_MS = 2000;

function Counts({ label, items }: { label: string; items: [number, string][] }) {
  return (
    <List aria-label={label} dense disablePadding>
      {items.map(([n, text]) => (
        <ListItem key={text} disableGutters>
          {n.toLocaleString('en-IN')} {text}
        </ListItem>
      ))}
    </List>
  );
}

export function ImportPage() {
  const { id } = useParams() as { id: string };
  const queryClient = useQueryClient();
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['import', id],
    queryFn: () => api<ImportDetails>(`/imports/${id}`),
    refetchInterval: (q) =>
      ['validating', 'applying'].includes(q.state.data?.status ?? '') ? POLL_MS : false,
  });
  const act = useMutation({
    mutationFn: (action: 'confirm' | 'cancel') =>
      api<ImportDetails>(`/imports/${id}/${action}`, { method: 'POST' }),
    onSuccess: (details) => {
      queryClient.setQueryData(['import', id], details);
      void queryClient.invalidateQueries({ queryKey: ['imports'] });
    },
    // e.g. 410: the preview expired meanwhile; show the current state.
    onError: () => void queryClient.invalidateQueries({ queryKey: ['import', id] }),
  });

  if (query.isError) return <Alert severity="error">{query.error.message}</Alert>;
  if (!query.data) return <LinearProgress />;
  const i = query.data;
  const c = i.counts;

  return (
    <Stack spacing={2}>
      <Typography variant="h4" component="h1">
        {i.fileName}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {IMPORT_STATUS_LABELS[i.status]} · {CHANGE_TYPE_LABELS[i.changeType]} effective{' '}
        {i.effectiveDate} · uploaded by {i.uploadedBy.name}
      </Typography>
      {act.error && <Alert severity="error">{act.error.message}</Alert>}

      {i.status === 'validating' && (
        <Stack spacing={1}>
          <Typography>Checking {i.rowCount.toLocaleString('en-IN')} rows…</Typography>
          <LinearProgress />
        </Stack>
      )}

      {i.status === 'awaiting_confirmation' && c && (
        <Paper sx={{ p: 2 }}>
          <Stack spacing={1}>
            <Counts
              label="Preview"
              items={[
                [c.total, 'rows'],
                [c.toCreate, 'to create'],
                [c.toUpdate, 'to update'],
                [c.unchanged, 'unchanged'],
                [c.rejected, 'rejected'],
              ]}
            />
            <Typography variant="body2">
              Nothing has changed yet. Confirm or cancel by{' '}
              {new Date(i.previewExpiresAt!).toLocaleString('en-IN')}; after that the preview
              expires.
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                onClick={() => act.mutate('confirm')}
                disabled={c.valid === 0 || act.isPending}
              >
                Import {c.valid.toLocaleString('en-IN')} valid rows
              </Button>
              <Button onClick={() => act.mutate('cancel')} disabled={act.isPending}>
                Cancel import
              </Button>
            </Stack>
          </Stack>
        </Paper>
      )}

      {i.status === 'applying' && (
        <Stack spacing={1}>
          <Typography>Importing the valid rows…</Typography>
          <LinearProgress />
        </Stack>
      )}

      {i.status === 'completed' && c && (
        <Paper sx={{ p: 2 }}>
          <Counts
            label="Result"
            items={[
              [c.created ?? 0, 'created'],
              [c.updated ?? 0, 'updated'],
              [c.unchanged, 'unchanged'],
              [c.rejected, 'rejected'],
            ]}
          />
        </Paper>
      )}

      {i.status === 'cancelled' && (
        <Alert severity="info">This import was cancelled. Nothing was changed.</Alert>
      )}
      {i.status === 'expired' && (
        <Alert severity="warning">
          The preview expired — upload again.{' '}
          <MuiLink component={Link} to="/imports">
            Upload again
          </MuiLink>
        </Alert>
      )}
      {i.status === 'failed' && (
        <Alert severity="error">
          The import stopped: {i.error}. Rows already imported are kept; upload the file again to
          finish.
        </Alert>
      )}

      {i.rejected.length > 0 && (
        <>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <Typography variant="h6" component="h2">
              Rejected rows
            </Typography>
            {['awaiting_confirmation', 'applying'].includes(i.status) && (
              <Button
                size="small"
                variant="outlined"
                onClick={() =>
                  download(`/imports/${id}/rejected.csv`).catch((e: Error) =>
                    setDownloadError(e.message),
                  )
                }
              >
                Download rejected rows
              </Button>
            )}
          </Stack>
          {downloadError && <Alert severity="error">{downloadError}</Alert>}
          {c && c.rejected > i.rejected.length && (
            <Typography variant="body2" color="text.secondary">
              Showing the first {i.rejected.length} of {c.rejected.toLocaleString('en-IN')}.
            </Typography>
          )}
          <Paper>
            <Table aria-label="Rejected rows" size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Row</TableCell>
                  <TableCell>Employee code</TableCell>
                  <TableCell>Reasons</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {i.rejected.map((r) => (
                  <TableRow key={r.rowNumber}>
                    <TableCell>{r.rowNumber}</TableCell>
                    <TableCell>{r.employeeCode}</TableCell>
                    <TableCell>{r.errors.join('; ')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        </>
      )}
    </Stack>
  );
}
