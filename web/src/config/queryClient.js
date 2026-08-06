/**
 * Shared React Query configuration optimized for fast navigation.
 *
 * Data remains fresh for five minutes, is retained for thirty minutes, and
 * concurrent consumers automatically share the same in-flight request.
 *
 * @author Eman, Malak
 */

import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      retry: 1,
      retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 2000),
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: { retry: 0 },
  },
});
