'use client';

import { useCallback } from 'react';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '@/lib/msalConfig';

/**
 * Shared hook for acquiring a Microsoft Graph API access token.
 * Wraps the acquireTokenSilent + acquireTokenPopup fallback pattern
 * that is used across multiple pages.
 */
export function useGraphToken() {
  const { instance, accounts, inProgress } = useMsal();
  const isAuthenticated = accounts.length > 0;

  const acquireToken = useCallback(async (): Promise<string> => {
    const account = accounts[0];
    try {
      const response = await instance.acquireTokenSilent({ ...loginRequest, account });
      return response.accessToken;
    } catch (silentError: unknown) {
      if (silentError instanceof Error && silentError.name === 'InteractionRequiredAuthError') {
        const response = await instance.acquireTokenPopup(loginRequest);
        return response.accessToken;
      }
      throw silentError;
    }
  }, [instance, accounts]);

  const handleLogin = useCallback(async () => {
    await instance.loginPopup(loginRequest);
  }, [instance]);

  return { acquireToken, isAuthenticated, inProgress, handleLogin, instance };
}
