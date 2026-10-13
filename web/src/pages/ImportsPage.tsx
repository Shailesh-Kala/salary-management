import { NOTE_MIN_LENGTH } from '@shared/employee-rules.ts';
import {
  Alert,
  Button,
  Link as MuiLink,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, ApiError, download } from '../api/client.ts';
import { CHANGE_TYPE_LABELS, saveErrors } from '../api/employees.ts';
import { IMPORT_CHANGE_TYPES, IMPORT_STATUS_LABELS, type ImportSummary } from '../api/imports.ts';

function UploadForm() {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({ changeType: 'annual_review', effectiveDate: '', note: '' });
  const upload = useMutation({
    mutationFn: () => {
      const body = new FormData();
      body.append('file', file!);
      for (const [key, value] of Object.entries(form)) body.append(key, value);
      return api<{ id: string }>('/imports', { method: 'POST', body });
    },
    onSuccess: ({ id }) => navigate(`/imports/${id}`),
  });
  const { general, fields } = saveErrors(upload.error);
  const inProgress =
    upload.error instanceof ApiError && upload.error.code === 'IMPORT_IN_PROGRESS'
      ? (upload.error.details as { importId: string | null }).importId
      : null;

  return (
    <Paper sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Typography variant="h6" component="h2">
          Upload a file
        </Typography>
        {general && (
          <Alert severity="error">
            {general}{' '}
            {inProgress && (
              <MuiLink component={Link} to={`/imports/${inProgress}`}>
                Open the import in progress
              </MuiLink>
            )}
          </Alert>
        )}
        <TextField
          label="CSV file"
          type="file"
          onChange={(e) => setFile((e.target as HTMLInputElement).files?.[0] ?? null)}
          error={Boolean(fields.file)}
          helperText={fields.file ?? 'Up to 5 MB and 20,000 rows, in the template format'}
          slotProps={{ inputLabel: { shrink: true }, htmlInput: { accept: '.csv,text/csv' } }}
        />
        <TextField
          select
          label="Change type"
          value={form.changeType}
          onChange={(e) => setForm({ ...form, changeType: e.target.value })}
          helperText="Applied to every pay or title change in the file"
        >
          {IMPORT_CHANGE_TYPES.map((type) => (
            <MenuItem key={type} value={type}>
              {CHANGE_TYPE_LABELS[type]}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Effective date"
          type="date"
          value={form.effectiveDate}
          onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })}
          error={Boolean(fields.effectiveDate)}
          helperText={fields.effectiveDate}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField
          label="Note"
          multiline
          minRows={2}
          value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
          error={Boolean(fields.note)}
          helperText={
            fields.note ??
            `Why these changes are being made (at least ${NOTE_MIN_LENGTH} characters)`
          }
        />
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            onClick={() => upload.mutate()}
            disabled={!file || !form.effectiveDate || !form.note.trim() || upload.isPending}
          >
            Upload
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

export function ImportsPage() {
  const [templateError, setTemplateError] = useState<string | null>(null);
  const history = useQuery({
    queryKey: ['imports'],
    queryFn: () => api<{ items: ImportSummary[]; total: number }>('/imports'),
  });

  return (
    <Stack spacing={2}>
      <Typography variant="h4" component="h1">
        Imports
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Add or update employees from a CSV file. You will see a preview of every row before anything
        changes.
      </Typography>
      <div>
        <Button
          variant="outlined"
          onClick={() =>
            download('/imports/template').catch((e: Error) => setTemplateError(e.message))
          }
        >
          Download template
        </Button>
      </div>
      {templateError && <Alert severity="error">{templateError}</Alert>}

      <UploadForm />

      <Typography variant="h6" component="h2">
        Import history
      </Typography>
      {history.isError && <Alert severity="error">{history.error.message}</Alert>}
      {history.data?.items.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          No imports yet.
        </Typography>
      )}
      {Boolean(history.data?.items.length) && (
        <Paper>
          <Table aria-label="Import history" size="small">
            <TableHead>
              <TableRow>
                <TableCell>Uploaded</TableCell>
                <TableCell>File</TableCell>
                <TableCell>Change type</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Rows</TableCell>
                <TableCell>By</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {history.data?.items.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>{new Date(i.createdAt).toLocaleString('en-IN')}</TableCell>
                  <TableCell>
                    <MuiLink component={Link} to={`/imports/${i.id}`}>
                      {i.fileName}
                    </MuiLink>
                  </TableCell>
                  <TableCell>{CHANGE_TYPE_LABELS[i.changeType]}</TableCell>
                  <TableCell>{IMPORT_STATUS_LABELS[i.status]}</TableCell>
                  <TableCell align="right">{i.rowCount.toLocaleString('en-IN')}</TableCell>
                  <TableCell>{i.uploadedBy.name}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
    </Stack>
  );
}
