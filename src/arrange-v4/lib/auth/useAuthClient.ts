'use client';

import { useAuthProvider } from './AuthContext';
import type { AuthClient } from './types';

export function useAuthClient(): AuthClient {
  return useAuthProvider().client;
}
