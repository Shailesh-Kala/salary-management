import { QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from './client.ts';

/**
 * A 401 from any query means the session ended (expired, logged out elsewhere, disabled):
 * clearing the user makes RequireAuth send them to login and back afterwards.
 */
export function createQueryClient({ retry = true }: { retry?: boolean } = {}) {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (error instanceof ApiError && error.status === 401 && query.queryKey[0] !== 'me') {
          client.setQueryData(['me'], null);
        }
      },
    }),
    defaultOptions: {
      queries: {
        // Client errors won't fix themselves; retry only network and server failures.
        retry: (failures, error) =>
          retry &&
          !(error instanceof ApiError && error.status >= 400 && error.status < 500) &&
          failures < 2,
      },
    },
  });
  return client;
}
