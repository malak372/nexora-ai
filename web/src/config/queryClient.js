/**
 * Shared React Query configuration optimized for fast navigation.
 *
 * Cached data is shown immediately while inactive data is retained long enough
 * for normal back/forward navigation. Automatic focus refetches stay disabled
 * so changing browser tabs does not unexpectedly duplicate API work.
 */
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      retry: 1,
      retryDelay: (attempt) => Math.min(350 * 2 ** attempt, 1500),
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
