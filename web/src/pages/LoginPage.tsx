import { Alert, Box, Button, Paper, TextField, Typography } from '@mui/material';
import { type FormEvent, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { safeNext, useLogin } from '../auth/session.ts';

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    login.mutate(
      { email, password },
      { onSuccess: () => navigate(safeNext(params.get('next')), { replace: true }) },
    );
  };

  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh', px: 2 }}>
      <Paper
        component="form"
        onSubmit={submit}
        sx={{ p: 4, width: '100%', maxWidth: 400, display: 'grid', gap: 2 }}
      >
        <Typography variant="h5" component="h1">
          Salary Management
        </Typography>
        {login.isError && <Alert severity="error">{login.error.message}</Alert>}
        <TextField
          label="Email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" variant="contained" disabled={login.isPending}>
          Sign in
        </Button>
      </Paper>
    </Box>
  );
}
