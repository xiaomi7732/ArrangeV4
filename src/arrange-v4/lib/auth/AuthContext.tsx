'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useGoogleAuthClient } from './google/GoogleAuthClient';
import { useMicrosoftAuthClient } from './microsoft/MicrosoftAuthClient';
import type { AuthClient, AuthProvider } from './types';

const AUTH_PROVIDER_KEY = 'arrange_auth_provider';
const providerListeners = new Set<() => void>();
let volatileProvider: AuthProvider | null = null;

interface AuthContextValue {
  client: AuthClient;
  activeProvider: AuthProvider;
  googleEnabled: boolean;
  googleReady: boolean;
  googleBusy: boolean;
  loginWithProvider(provider: AuthProvider): Promise<void>;
  retryGoogleInitialization(): Promise<void>;
  selectProvider(provider: AuthProvider): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function isGoogleProviderEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_GOOGLE_PROVIDER !== 'false'
    && !!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
}

function readStoredProvider(googleEnabled: boolean): AuthProvider {
  if (typeof window === 'undefined') return 'microsoft';
  if (volatileProvider === 'google' && googleEnabled) return 'google';
  if (volatileProvider === 'microsoft') return 'microsoft';
  try {
    const stored = localStorage.getItem(AUTH_PROVIDER_KEY);
    if (stored === 'google' && googleEnabled) {
      volatileProvider = 'google';
      return 'google';
    }
    if (stored === 'microsoft') {
      volatileProvider = 'microsoft';
      return 'microsoft';
    }
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
  volatileProvider = 'microsoft';
  return 'microsoft';
}

function storeProvider(provider: AuthProvider): void {
  volatileProvider = provider;
  try {
    localStorage.setItem(AUTH_PROVIDER_KEY, provider);
  } catch {
    // The active provider still works for this page even when persistence is blocked.
  }
  providerListeners.forEach(listener => listener());
}

function subscribeToProvider(listener: () => void): () => void {
  providerListeners.add(listener);
  return () => {
    providerListeners.delete(listener);
  };
}

export function ActiveAuthProvider({ children }: { children: ReactNode }) {
  const googleConfigured = isGoogleProviderEnabled();
  const microsoft = useMicrosoftAuthClient();
  const google = useGoogleAuthClient(googleConfigured);
  const googleEnabled = googleConfigured;
  const activeProvider = useSyncExternalStore<AuthProvider>(
    subscribeToProvider,
    () => readStoredProvider(googleConfigured),
    () => 'microsoft' as const,
  );

  const selectProvider = useCallback((provider: AuthProvider) => {
    if (provider === 'google' && !googleConfigured) {
      throw new Error(
        'Google sign-in is not configured. Set NEXT_PUBLIC_GOOGLE_CLIENT_ID to enable it.',
      );
    }
    storeProvider(provider);
  }, [googleConfigured]);

  const loginWithProvider = useCallback(async (provider: AuthProvider) => {
    selectProvider(provider);
    await (provider === 'google' ? google : microsoft).login();
  }, [google, microsoft, selectProvider]);

  const retryGoogleInitialization = useCallback(async () => {
    await google.prepare?.();
  }, [google]);

  const client = activeProvider === 'google' ? google : microsoft;
  const value = useMemo<AuthContextValue>(() => ({
    client,
    activeProvider,
    googleEnabled,
    googleReady: google.ready,
    googleBusy: google.busy,
    loginWithProvider,
    retryGoogleInitialization,
    selectProvider,
  }), [
    client,
    activeProvider,
    googleEnabled,
    google.ready,
    google.busy,
    loginWithProvider,
    retryGoogleInitialization,
    selectProvider,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthProvider(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuthProvider must be used within ActiveAuthProvider.');
  }
  return value;
}
