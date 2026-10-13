import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import { DataGrid, type GridColDef, type GridSortModel } from '@mui/x-data-grid';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api } from '../api/client.ts';
import { type EmployeeStatus, useFilterOptions } from '../api/employees.ts';
import { asOptions, SelectFilter } from '../components/SelectFilter.tsx';
import { STATUS, StatusChip } from '../components/StatusChip.tsx';
import { formatMoney } from '../lib/format.ts';

type EmployeeListItem = {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  department: string;
  countryCode: string;
  currencyCode: string;
  hireDate: string;
  annualSalary: string;
  convertedAnnualSalary: string;
  status: EmployeeStatus;
};

type EmployeeList = {
  items: EmployeeListItem[];
  total: number;
  currency: string;
  ratesAsOf: string;
};

// Grid column ↔ API sort key.
const SORT_BY_FIELD: Record<string, string> = {
  employeeCode: 'employeeCode',
  name: 'name',
  jobTitle: 'jobTitle',
  department: 'department',
  countryCode: 'country',
  hireDate: 'hireDate',
  convertedAnnualSalary: 'annualSalary',
};
const FIELD_BY_SORT = Object.fromEntries(Object.entries(SORT_BY_FIELD).map(([f, s]) => [s, f]));

const FILTERS = ['q', 'country', 'department', 'jobTitle', 'status'] as const;

/** List state lives in the URL, so it survives reloads and the login round-trip. */
function useListParams() {
  const [params, setParams] = useSearchParams();
  const state = {
    page: Number(params.get('page') ?? 1),
    pageSize: Number(params.get('pageSize') ?? 25),
    sort: params.get('sort') ?? 'name',
    order: params.get('order') === 'desc' ? 'desc' : 'asc',
    currency: params.get('currency') ?? 'INR',
    ...Object.fromEntries(FILTERS.map((f) => [f, params.get(f) ?? ''])),
  } as Record<'sort' | 'order' | 'currency' | (typeof FILTERS)[number], string> & {
    page: number;
    pageSize: number;
  };

  const update = (patch: Partial<Record<string, string | number>>) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries<string | number | undefined>({
        page: 1,
        ...patch,
      })) {
        if (value === '' || value === undefined) next.delete(key);
        else next.set(key, String(value));
      }
      return next;
    });

  return { state, update };
}

export function EmployeesPage() {
  const { state, update } = useListParams();
  const [search, setSearch] = useState(state.q);

  // Debounce: query once typing pauses for 300 ms.
  useEffect(() => {
    if (search.trim() === state.q) return;
    const timer = setTimeout(() => update({ q: search.trim() }), 300);
    return () => clearTimeout(timer);
  }, [search, state.q]); // eslint-disable-line react-hooks/exhaustive-deps

  const options = useFilterOptions();
  const navigate = useNavigate();

  const query = new URLSearchParams({
    page: String(state.page),
    pageSize: String(state.pageSize),
    sort: state.sort,
    order: state.order,
    currency: state.currency,
  });
  for (const f of FILTERS) if (state[f]) query.set(f, state[f]);

  const list = useQuery({
    queryKey: ['employees', query.toString()],
    queryFn: () => api<EmployeeList>(`/employees?${query}`),
    placeholderData: keepPreviousData,
  });

  const currency = list.data?.currency ?? state.currency;
  const columns: GridColDef<EmployeeListItem>[] = [
    { field: 'employeeCode', headerName: 'Code', width: 110 },
    {
      field: 'name',
      headerName: 'Name',
      flex: 1,
      minWidth: 160,
      valueGetter: (_value, row) => `${row.firstName} ${row.lastName}`,
    },
    { field: 'jobTitle', headerName: 'Job title', flex: 1, minWidth: 170 },
    { field: 'department', headerName: 'Department', width: 150 },
    { field: 'countryCode', headerName: 'Country', width: 90 },
    { field: 'hireDate', headerName: 'Hire date', width: 110 },
    {
      field: 'annualSalary',
      headerName: 'Annual salary (local)',
      width: 180,
      sortable: false,
      align: 'right',
      headerAlign: 'right',
      renderCell: ({ row }) => formatMoney(row.annualSalary, row.currencyCode),
    },
    {
      field: 'convertedAnnualSalary',
      headerName: `Annual salary (${currency})`,
      width: 180,
      align: 'right',
      headerAlign: 'right',
      renderCell: ({ row }) => formatMoney(row.convertedAnnualSalary, currency),
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 120,
      sortable: false,
      renderCell: ({ row }) => <StatusChip status={row.status} />,
    },
  ];

  const sortModel: GridSortModel = [
    { field: FIELD_BY_SORT[state.sort] ?? 'name', sort: state.order === 'desc' ? 'desc' : 'asc' },
  ];

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ alignItems: 'center' }}>
        <Typography variant="h4" component="h1">
          Employees
        </Typography>
        <Button component={Link} to="/employees/new" variant="contained" sx={{ ml: 'auto' }}>
          Add employee
        </Button>
      </Stack>

      <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap' }}>
        <TextField
          size="small"
          label="Search"
          placeholder="Name, email or code"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ minWidth: 240 }}
        />
        <SelectFilter
          label="Country"
          allLabel="All countries"
          value={state.country}
          options={(options.data?.countries ?? []).map((c) => ({ value: c.code, label: c.name }))}
          onChange={(country) => update({ country })}
        />
        <SelectFilter
          label="Department"
          allLabel="All departments"
          value={state.department}
          options={asOptions(options.data?.departments)}
          onChange={(department) => update({ department })}
        />
        <SelectFilter
          label="Job title"
          allLabel="All job titles"
          value={state.jobTitle}
          options={asOptions(options.data?.jobTitles)}
          onChange={(jobTitle) => update({ jobTitle })}
        />
        <SelectFilter
          label="Status"
          allLabel="All statuses"
          value={state.status}
          options={Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }))}
          onChange={(status) => update({ status })}
        />
        <SelectFilter
          label="Currency"
          value={state.currency}
          options={asOptions(options.data?.currencies ?? [state.currency])}
          onChange={(value) => update({ currency: value })}
        />
      </Stack>

      {list.isError && <Alert severity="error">{list.error.message}</Alert>}

      {list.data && (
        <Stack direction="row" spacing={2} sx={{ color: 'text.secondary' }}>
          <Typography variant="body2">
            {list.data.total.toLocaleString('en-IN')} employees
          </Typography>
          <Typography variant="body2">
            Converted salaries use rates as of {list.data.ratesAsOf}
          </Typography>
        </Stack>
      )}

      <Box sx={{ height: 640 }}>
        <DataGrid
          rows={list.data?.items ?? []}
          columns={columns}
          rowCount={list.data?.total ?? 0}
          loading={list.isFetching}
          paginationMode="server"
          sortingMode="server"
          paginationModel={{ page: state.page - 1, pageSize: state.pageSize }}
          onPaginationModelChange={(m) => update({ page: m.page + 1, pageSize: m.pageSize })}
          pageSizeOptions={[25, 50, 100]}
          sortModel={sortModel}
          sortingOrder={['asc', 'desc']}
          onSortModelChange={([s]) =>
            update(s ? { sort: SORT_BY_FIELD[s.field] ?? 'name', order: s.sort ?? 'asc' } : {})
          }
          onRowClick={({ id }) => navigate(`/employees/${id}`)}
          sx={{ '& .MuiDataGrid-row': { cursor: 'pointer' } }}
          disableColumnFilter
          disableRowSelectionOnClick
        />
      </Box>
    </Stack>
  );
}
