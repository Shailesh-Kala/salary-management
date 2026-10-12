export type EmployeeStatus = 'active' | 'on_notice' | 'exited';

/** Derived, never stored (D-014): on notice through the last working day, exited after it. */
export function employeeStatus(lastWorkingDay: string | null, today: string): EmployeeStatus {
  if (!lastWorkingDay) return 'active';
  return lastWorkingDay >= today ? 'on_notice' : 'exited';
}
