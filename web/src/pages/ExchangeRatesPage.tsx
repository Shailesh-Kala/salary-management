import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client.ts';
import { saveErrors } from '../api/employees.ts';
import { formatRate } from '../lib/format.ts';

type Rate = {
  currencyCode: string;
  inrPerUnit: string;
  asOf: string;
  updatedBy: { id: string; name: string } | null;
  updatedAt: string;
};

type RateChange = {
  id: string;
  currencyCode: string;
  oldInrPerUnit: string;
  newInrPerUnit: string;
  oldAsOf: string;
  newAsOf: string;
  changedBy: { id: string; name: string };
  changedAt: string;
};

function RateDialog({ rate, onClose }: { rate: Rate; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    inrPerUnit: String(Number(rate.inrPerUnit)),
    asOf: rate.asOf,
  });
  const save = useMutation({
    mutationFn: () =>
      api<Rate>(`/exchange-rates/${rate.currencyCode}`, { method: 'PUT', body: form }),
    onSuccess: () => {
      // Every converted salary depends on the rates.
      for (const key of ['exchange-rates', 'exchange-rate-history', 'employees']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      onClose();
    },
  });
  const { general, fields } = saveErrors(save.error);

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Edit {rate.currencyCode} rate</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {general && <Alert severity="error">{general}</Alert>}
          <TextField
            label={`INR per 1 ${rate.currencyCode}`}
            value={form.inrPerUnit}
            onChange={(e) => setForm({ ...form, inrPerUnit: e.target.value })}
            error={Boolean(fields.inrPerUnit)}
            helperText={fields.inrPerUnit}
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
          />
          <TextField
            label="As of"
            type="date"
            value={form.asOf}
            onChange={(e) => setForm({ ...form, asOf: e.target.value })}
            error={Boolean(fields.asOf)}
            helperText={fields.asOf ?? 'The date this rate applies from'}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => save.mutate()}
          disabled={!form.inrPerUnit.trim() || !form.asOf || save.isPending}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function ExchangeRatesPage() {
  const [editing, setEditing] = useState<Rate | null>(null);
  const rates = useQuery({
    queryKey: ['exchange-rates'],
    queryFn: () => api<{ items: Rate[] }>('/exchange-rates'),
  });
  const history = useQuery({
    queryKey: ['exchange-rate-history'],
    queryFn: () => api<{ items: RateChange[]; total: number }>('/exchange-rates/history'),
  });

  return (
    <Stack spacing={2}>
      <Typography variant="h4" component="h1">
        Exchange rates
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Rates are INR per 1 unit of each currency. Converted salaries across the app use them.
      </Typography>

      {rates.isError && <Alert severity="error">{rates.error.message}</Alert>}
      <Paper>
        <Table aria-label="Exchange rates" size="small">
          <TableHead>
            <TableRow>
              <TableCell>Currency</TableCell>
              <TableCell align="right">INR per unit</TableCell>
              <TableCell>As of</TableCell>
              <TableCell>Last changed by</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {rates.data?.items.map((rate) => (
              <TableRow key={rate.currencyCode}>
                <TableCell>{rate.currencyCode}</TableCell>
                <TableCell align="right">{formatRate(rate.inrPerUnit)}</TableCell>
                <TableCell>{rate.asOf}</TableCell>
                <TableCell>{rate.updatedBy?.name ?? 'Initial snapshot'}</TableCell>
                <TableCell align="right">
                  {rate.currencyCode === 'INR' ? (
                    <Typography variant="caption" color="text.secondary">
                      Base currency
                    </Typography>
                  ) : (
                    <Button
                      size="small"
                      aria-label={`Edit ${rate.currencyCode} rate`}
                      onClick={() => setEditing(rate)}
                    >
                      Edit
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Typography variant="h6" component="h2">
        Rate history
      </Typography>
      {history.isError && <Alert severity="error">{history.error.message}</Alert>}
      {history.data?.items.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No rate changes yet.
        </Typography>
      ) : (
        <Paper>
          <Table aria-label="Rate history" size="small">
            <TableHead>
              <TableRow>
                <TableCell>Changed</TableCell>
                <TableCell>Currency</TableCell>
                <TableCell>INR per unit</TableCell>
                <TableCell>As of</TableCell>
                <TableCell>By</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {history.data?.items.map((h) => (
                <TableRow key={h.id}>
                  <TableCell>{new Date(h.changedAt).toLocaleString('en-IN')}</TableCell>
                  <TableCell>{h.currencyCode}</TableCell>
                  <TableCell>
                    {formatRate(h.oldInrPerUnit)} → {formatRate(h.newInrPerUnit)}
                  </TableCell>
                  <TableCell>
                    {h.oldAsOf} → {h.newAsOf}
                  </TableCell>
                  <TableCell>{h.changedBy.name}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      {editing && <RateDialog rate={editing} onClose={() => setEditing(null)} />}
    </Stack>
  );
}
