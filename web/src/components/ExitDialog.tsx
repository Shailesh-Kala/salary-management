import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
} from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  type EmployeeDetail,
  EXIT_TYPE_LABELS,
  saveErrors,
  useEmployeeEvent,
} from '../api/employees.ts';
import { daysBetween } from '../lib/dates.ts';
import { VersionConflictAlert } from './VersionConflictAlert.tsx';

const dateProps = {
  type: 'date',
  slotProps: { inputLabel: { shrink: true } },
  fullWidth: true,
} as const;

export function ExitDialog({
  employee,
  onClose,
}: {
  employee: EmployeeDetail;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ exitType: '', noticeDate: '', lastWorkingDay: '', note: '' });
  const save = useEmployeeEvent(employee.id, '/exit', onClose);
  const { conflict, general, fields } = saveErrors(save.error);

  const bothDates = form.noticeDate !== '' && form.lastWorkingDay !== '';
  const outOfOrder = bothDates && form.lastWorkingDay < form.noticeDate;
  const noteLength = form.note.trim().length;
  const canSave =
    form.exitType !== '' && bothDates && !outOfOrder && noteLength >= 5 && noteLength <= 1000;

  const lastDayHelp =
    fields.lastWorkingDay ??
    (outOfOrder
      ? 'Last working day must be on or after the notice date'
      : bothDates
        ? `Notice period: ${daysBetween(form.noticeDate, form.lastWorkingDay)} days`
        : undefined);
  const set = (name: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [name]: e.target.value });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Record exit</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {conflict && (
            <VersionConflictAlert
              onReload={() => {
                void queryClient.invalidateQueries({ queryKey: ['employee', employee.id] });
                onClose();
              }}
            />
          )}
          {general && <Alert severity="error">{general}</Alert>}
          <TextField
            select
            label="Exit type"
            value={form.exitType}
            onChange={set('exitType')}
            error={Boolean(fields.exitType)}
            helperText={fields.exitType}
            fullWidth
          >
            {Object.entries(EXIT_TYPE_LABELS).map(([value, label]) => (
              <MenuItem key={value} value={value}>
                {label}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Notice date"
              value={form.noticeDate}
              onChange={set('noticeDate')}
              error={Boolean(fields.noticeDate)}
              helperText={fields.noticeDate ?? 'When the resignation or notice was given'}
              {...dateProps}
            />
            <TextField
              label="Last working day"
              value={form.lastWorkingDay}
              onChange={set('lastWorkingDay')}
              error={outOfOrder || Boolean(fields.lastWorkingDay)}
              helperText={lastDayHelp}
              {...dateProps}
            />
          </Stack>
          <TextField
            label="Note"
            value={form.note}
            onChange={set('note')}
            error={Boolean(fields.note)}
            helperText={fields.note ?? `Shown in the history (${noteLength}/1000)`}
            multiline
            minRows={2}
            required
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => save.mutate({ version: employee.version, ...form })}
          disabled={!canSave || save.isPending}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
