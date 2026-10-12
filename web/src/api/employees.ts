import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from './client.ts';

export type EmployeeStatus = 'active' | 'on_notice' | 'exited';

export type EmployeeDetail = {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string;
  department: string;
  countryCode: string;
  countryName: string;
  currencyCode: string;
  hireDate: string;
  baseSalary: string;
  allowances: string;
  exitType: 'resigned' | 'terminated' | null;
  noticeDate: string | null;
  lastWorkingDay: string | null;
  status: EmployeeStatus;
  version: number;
};

export type FilterOptions = {
  countries: { code: string; name: string; currencyCode: string }[];
  departments: string[];
  jobTitles: string[];
  currencies: string[];
};

export const useFilterOptions = () =>
  useQuery({
    queryKey: ['employee-filter-options'],
    queryFn: () => api<FilterOptions>('/employees/filter-options'),
    staleTime: 5 * 60_000,
  });

/** Server validation details keyed by field, for showing errors next to inputs. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  return Object.fromEntries((error.details ?? []).map((d) => [d.path, d.message]));
}

export type HistoryEntry = {
  id: string;
  changeType: string;
  effectiveDate: string;
  note: string;
  source: 'ui' | 'import' | 'seed';
  changes: Record<string, { old: string | null; new: string | null }>;
  snapshot: { currencyCode: string; countryCode: string };
  changedBy: { id: string; name: string };
  changedAt: string;
};

export const CHANGE_TYPE_LABELS: Record<string, string> = {
  hire: 'Hired',
  annual_review: 'Annual review',
  promotion: 'Promotion',
  market_adjustment: 'Market adjustment',
  relocation: 'Relocation',
  correction: 'Correction',
  exit: 'Exit recorded',
  exit_withdrawn: 'Exit withdrawn',
  other: 'Other',
};

/** Types HR can record in the change dialog (hire and exit have their own flows). */
export const RECORDABLE_CHANGE_TYPES = [
  'annual_review',
  'promotion',
  'market_adjustment',
  'relocation',
  'correction',
  'other',
] as const;
