import { Alert, Button } from '@mui/material';

/** Shown when the server rejects a save because someone else changed the employee first. */
export function VersionConflictAlert({ onReload }: { onReload: () => void }) {
  return (
    <Alert
      severity="warning"
      action={
        <Button color="inherit" size="small" onClick={onReload}>
          Reload
        </Button>
      }
    >
      Someone else updated this employee while you were editing. Reload to get their changes, then
      make your edit again.
    </Alert>
  );
}
