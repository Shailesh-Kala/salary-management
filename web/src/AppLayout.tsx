import { AppBar, Box, Button, Container, Toolbar, Typography } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
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
      <AppBar position="static">
        <Toolbar sx={{ gap: 2 }}>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            Salary Management
          </Typography>
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
