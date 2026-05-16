'use client';

import { useCallback, useMemo } from 'react';
import { useMsal } from '@azure/msal-react';
import { InteractionRequiredAuthError } from '@azure/msal-browser';
import { loginRequest } from '@/lib/msalConfig';
import type { AuthClient, AuthUser } from '../types';

/**
 * React hook that adapts MSAL into the `AuthClient` shape.
 *
 * All MSAL-specific knowledge stays in this file. Consumers depend only on
 * the `AuthClient` interface.
 */
export function useMicrosoftAuthClient(): AuthClient {
  const { instance, accounts, inProgress } = useMsal();
  const isAuthenticated = accounts.length > 0;
  const busy = inProgress !== 'none';

  const acquireToken = useCallback(async (options?: { silentOnly?: boolean }): Promise<string> => {
    // Read accounts fresh from the MSAL instance, not from the captured React
    // state. The captured state can lag by one render after loginPopup resolves,
    // which would cause the post-login "no account" race.
    const account = instance.getAllAccounts()[0];
    if (!account) {
      throw new Error(
        'No signed-in Microsoft account is available. Sign in before requesting a Microsoft Graph access token.',
      );
    }
    try {
      const response = await instance.acquireTokenSilent({ ...loginRequest, account });
      return response.accessToken;
    } catch (silentError: unknown) {
      if (options?.silentOnly) {
        throw silentError;
      }
      if (silentError instanceof InteractionRequiredAuthError) {
        const response = await instance.acquireTokenPopup(loginRequest);
        return response.accessToken;
      }
      throw silentError;
    }
  }, [instance]);

  const login = useCallback(async (): Promise<void> => {
    await instance.loginPopup(loginRequest);
  }, [instance]);

  const logout = useCallback(async (): Promise<void> => {
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
    const postLogoutRedirectUri =
      typeof window !== 'undefined'
        ? `${window.location.origin}${basePath}/`
        : '/';
    await instance.logoutPopup({ postLogoutRedirectUri });
  }, [instance]);

  const getUser = useCallback((): AuthUser | null => {
    const account = accounts[0];
    if (!account) return null;
    return {
      displayName: account.name || account.username,
      email: account.username,
    };
  }, [accounts]);

  return useMemo<AuthClient>(
    () => ({
      provider: 'microsoft',
      isAuthenticated,
      busy,
      acquireToken,
      login,
      logout,
      getUser,
    }),
    [isAuthenticated, busy, acquireToken, login, logout, getUser],
  );
}
