import { AppBar, Box, Button, Container, Toolbar, Typography } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { logout, type User } from './auth/session.ts';

export function AppLayout({ user, children }: { user: User; children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const signOut = useMutation({
    mutationFn: logout,
    onSettled: () => {
      navigate('/login', { replace: true });
      queryClient.clear(); // drop every cached response, including salary data
    },
  });

  return (
    <>
      <AppBar position="static" sx={{ displayPrint: 'none' }}>
        <Toolbar sx={{ gap: 2 }}>
          <Typography variant="h6" component="div">
            Salary Management
          </Typography>
          <Box component="nav" sx={{ flexGrow: 1, display: 'flex', gap: 1 }}>
            <Button color="inherit" component={Link} to="/employees">
              Employees
            </Button>
            <Button color="inherit" component={Link} to="/insights">
              Insights
            </Button>
            <Button color="inherit" component={Link} to="/exchange-rates">
              Exchange rates
            </Button>
          </Box>
          <Typography variant="body2">{user.name}</Typography>
          <Button color="inherit" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
            Sign out
          </Button>
        </Toolbar>
      </AppBar>
      <Container sx={{ py: 3 }}>
        <Box component="main">{children}</Box>
      </Container>
    </>
  );
}
