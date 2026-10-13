import { NOTE_MAX_LENGTH, NOTE_MIN_LENGTH } from '@shared/employee-rules.ts';
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
  type TextFieldProps,
} from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  CHANGE_TYPE_LABELS,
  type EmployeeDetail,
  type FilterOptions,
  RECORDABLE_CHANGE_TYPES,
  saveErrors,
  useEmployeeEvent,
} from '../api/employees.ts';
import { VersionConflictAlert } from './VersionConflictAlert.tsx';

type Props = {
  employee: EmployeeDetail;
  countries: FilterOptions['countries'];
  onClose: () => void;
};

export function ChangeDialog({ employee, countries, onClose }: Props) {
  const queryClient = useQueryClient();
  const current = {
    baseSalary: employee.baseSalary,
    allowances: employee.allowances,
    countryCode: employee.countryCode,
  };
  const [form, setForm] = useState({
    changeType: '',
    effectiveDate: '',
    note: '',
    jobTitle: employee.jobTitle,
    department: employee.department,
    hireDate: employee.hireDate,
    ...current,
  });

  const relocation = form.changeType === 'relocation';
  const correction = form.changeType === 'correction';
  // Exited employees can only be corrected (the server enforces this too).
  const types = employee.status === 'exited' ? (['correction'] as const) : RECORDABLE_CHANGE_TYPES;
  const currency = relocation
    ? (countries.find((c) => c.code === form.countryCode)?.currencyCode ?? 'new currency')
    : employee.currencyCode;

  const setType = (changeType: string) =>
    setForm((f) => ({
      ...f,
      changeType,
      // A relocation needs new pay in the new currency, so start those fields empty.
      ...(changeType === 'relocation'
        ? { baseSalary: '', allowances: '', countryCode: '' }
        : current),
    }));

  const save = useEmployeeEvent(employee.id, '/changes', onClose);
  const submit = () => {
    const { countryCode, hireDate, ...fields } = form;
    const body = {
      version: employee.version,
      ...fields,
      ...(relocation && { countryCode }),
      ...(correction && { hireDate }),
    };
    save.mutate(Object.fromEntries(Object.entries(body).filter(([, v]) => v !== '')));
  };

  const noteLength = form.note.trim().length;
  const canSave =
    form.changeType !== '' &&
    form.effectiveDate !== '' &&
    noteLength >= NOTE_MIN_LENGTH &&
    noteLength <= NOTE_MAX_LENGTH &&
    (!relocation ||
      (form.countryCode !== '' && form.baseSalary.trim() !== '' && form.allowances.trim() !== ''));

  const { conflict, general, fields: errors } = saveErrors(save.error);
  const reload = () => {
    void queryClient.invalidateQueries({ queryKey: ['employee', employee.id] });
    onClose();
  };

  const field = (name: keyof typeof form, label: string, props: TextFieldProps = {}) => (
    <TextField
      label={label}
      value={form[name]}
      onChange={(e) => setForm({ ...form, [name]: e.target.value })}
      error={Boolean(errors[name])}
      helperText={errors[name]}
      fullWidth
      {...props}
    />
  );
  const date = { type: 'date', slotProps: { inputLabel: { shrink: true } } } as const;

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Record change</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {conflict && <VersionConflictAlert onReload={reload} />}
          {general && <Alert severity="error">{general}</Alert>}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              select
              label="Change type"
              value={form.changeType}
              onChange={(e) => setType(e.target.value)}
              error={Boolean(errors.changeType)}
              helperText={errors.changeType}
              fullWidth
            >
              {types.map((t) => (
                <MenuItem key={t} value={t}>
                  {CHANGE_TYPE_LABELS[t]}
                </MenuItem>
              ))}
            </TextField>
            {field('effectiveDate', 'Effective date', date)}
          </Stack>
          {relocation &&
            field('countryCode', 'New country', {
              select: true,
              children: countries
                .filter((c) => c.code !== employee.countryCode)
                .map((c) => (
                  <MenuItem key={c.code} value={c.code}>
                    {c.name}
                  </MenuItem>
                )),
            })}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            {field('baseSalary', `Base salary (${currency})`, { required: relocation })}
            {field('allowances', `Allowances (${currency})`, { required: relocation })}
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            {field('jobTitle', 'Job title')}
            {field('department', 'Department')}
          </Stack>
          {correction && field('hireDate', 'Hire date', date)}
          {field('note', 'Note', {
            multiline: true,
            minRows: 2,
            required: true,
            helperText:
              errors.note ??
              `Shown in the history, e.g. appreciation or the reason (${noteLength}/${NOTE_MAX_LENGTH})`,
          })}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={!canSave || save.isPending}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
