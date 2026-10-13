import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  TextField,
} from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { type EmployeeDetail, saveErrors, useEmployeeEvent } from '../api/employees.ts';
import { VersionConflictAlert } from './VersionConflictAlert.tsx';

export function WithdrawExitDialog({
  employee,
  onClose,
}: {
  employee: EmployeeDetail;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const save = useEmployeeEvent(employee.id, '/exit/withdraw', onClose);
  const { conflict, general, fields } = saveErrors(save.error);
  const noteLength = note.trim().length;

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Withdraw exit</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <DialogContentText>
            {employee.firstName} stays employed: the notice date and last working day (
            {employee.lastWorkingDay}) are cleared.
          </DialogContentText>
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
            label="Note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            error={Boolean(fields.note)}
            helperText={fields.note ?? `Why the exit is withdrawn (${noteLength}/1000)`}
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
          onClick={() => save.mutate({ version: employee.version, note })}
          disabled={noteLength < 5 || noteLength > 1000 || save.isPending}
        >
          Withdraw
        </Button>
      </DialogActions>
    </Dialog>
  );
}
