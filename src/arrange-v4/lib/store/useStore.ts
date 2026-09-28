'use client';

import { useMemo } from 'react';
import { useAuthClient } from '@/lib/auth/useAuthClient';
import { MultiBackendStore } from './multiStore';

/**
 * React hook that returns a `MultiBackendStore` bound to the current user's
 * token acquisition function. The store instance is memoized so identity is
 * stable across renders, which keeps dependent useEffect/useCallback hooks
 * from re-firing on every parent render.
 */
export function useStore(): MultiBackendStore {
  const { acquireToken } = useAuthClient();
  return useMemo(() => new MultiBackendStore({ acquireToken }), [acquireToken]);
}
