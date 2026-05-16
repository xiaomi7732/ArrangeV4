'use client';

import { useMicrosoftAuthClient } from './microsoft/MicrosoftAuthClient';
import type { AuthClient } from './types';

/**
 * Returns the active `AuthClient` for the current user.
 *
 * Today this always returns the Microsoft client. When additional providers
 * are added, this hook will select the right implementation based on the
 * user's stored provider preference.
 */
export function useAuthClient(): AuthClient {
  return useMicrosoftAuthClient();
}
