import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client.ts';

export type User = { id: string; email: string; name: string };

const ME = ['me'];

/** The signed-in user, or null when there is no valid session. */
export function useMe() {
  return useQuery({
    queryKey: ME,
    staleTime: 5 * 60_000, // login already returned the user; no need to re-ask at once
    queryFn: async () => {
      try {
        return (await api<{ user: User }>('/auth/me')).user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (credentials: { email: string; password: string }) =>
      (await api<{ user: User }>('/auth/login', { method: 'POST', body: credentials })).user,
    onSuccess: (user) => queryClient.setQueryData(ME, user),
  });
}

export const logout = () => api<void>('/auth/logout', { method: 'POST' });

/** Only same-app paths are allowed after login, so ?next= can't send users to another site. */
export function safeNext(next: string | null): string {
  const sameApp = next?.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\');
  return sameApp ? next! : '/employees';
}
