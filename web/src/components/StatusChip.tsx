import { Chip } from '@mui/material';
import type { EmployeeStatus } from '../api/employees.ts';

export const STATUS: Record<
  EmployeeStatus,
  { label: string; color: 'success' | 'warning' | 'default' }
> = {
  active: { label: 'Active', color: 'success' },
  on_notice: { label: 'On notice', color: 'warning' },
  exited: { label: 'Exited', color: 'default' },
};

export function StatusChip({ status }: { status: EmployeeStatus }) {
  return <Chip size="small" label={STATUS[status].label} color={STATUS[status].color} />;
}
