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
