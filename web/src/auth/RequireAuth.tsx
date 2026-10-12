import { Alert, Box, CircularProgress } from '@mui/material';
import { Navigate, Outlet, useLocation } from 'react-router';
import { AppLayout } from '../AppLayout.tsx';
import { useMe } from './session.ts';

export function RequireAuth() {
  const me = useMe();
  const location = useLocation();

  if (me.isPending) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <CircularProgress aria-label="Checking your session" />
      </Box>
    );
  }
  if (me.data) {
    return (
      <AppLayout user={me.data}>
        <Outlet />
      </AppLayout>
    );
  }
  if (me.isError) {
    return <Alert severity="error">{me.error.message}</Alert>;
  }
  const next = encodeURIComponent(location.pathname + location.search);
  return <Navigate to={`/login?next=${next}`} replace />;
}
