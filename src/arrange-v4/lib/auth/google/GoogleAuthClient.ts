'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { InteractiveAuthenticationRequiredError } from '../errors';
import { clearCachedBooks } from '@/lib/books/bookListCache';
import type { AcquireTokenOptions, AuthClient, AuthUser } from '../types';

const GIS_SCRIPT_ID = 'google-identity-services';
const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
const TOKEN_KEY = 'arrange_google_token';
const USER_KEY = 'arrange_google_user';
const TOKEN_EXPIRY_BUFFER_MS = 60_000;
const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.file',
].join(' ');

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface GoogleTokenClient {
  requestAccessToken(options?: { prompt?: string }): void;
}

interface GoogleOAuth2Api {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback(response: GoogleTokenResponse): void;
    error_callback?(error: { type?: string; message?: string }): void;
  }): GoogleTokenClient;
  revoke(token: string, callback?: () => void): void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: GoogleOAuth2Api;
      };
    };
  }
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let gisScriptPromise: Promise<void> | null = null;
let volatileToken: CachedToken | null = null;
let volatileUser: AuthUser | null = null;

function loadGoogleIdentityServices(): Promise<void> {
  if (window.google?.accounts.oauth2) return Promise.resolve();
  if (gisScriptPromise) return gisScriptPromise;

  gisScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(GIS_SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement('script');
    const onLoad = () => {
      if (window.google?.accounts.oauth2) resolve();
      else reject(new Error('Google Identity Services loaded without the OAuth client API.'));
    };
    const onError = () => reject(new Error('Failed to load Google Identity Services.'));

    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    if (!existing) {
      script.id = GIS_SCRIPT_ID;
      script.src = GIS_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  }).catch(error => {
    gisScriptPromise = null;
    document.getElementById(GIS_SCRIPT_ID)?.remove();
    throw error;
  });

  return gisScriptPromise;
}

function readSessionValue<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

function writeSessionValue(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Authentication remains usable until this page is reloaded.
  }
}

function readCachedToken(): CachedToken | null {
  return readSessionValue<CachedToken>(TOKEN_KEY) ?? volatileToken;
}

function writeCachedToken(token: CachedToken): void {
  volatileToken = token;
  writeSessionValue(TOKEN_KEY, token);
}

function readCachedUser(): AuthUser | null {
  return readSessionValue<AuthUser>(USER_KEY) ?? volatileUser;
}

function writeCachedUser(user: AuthUser): void {
  volatileUser = user;
  writeSessionValue(USER_KEY, user);
}

function clearGoogleSession(): void {
  volatileToken = null;
  volatileUser = null;
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
  } catch {
    // Nothing else can be done when browser storage is unavailable.
  }
}

function clearGoogleToken(): void {
  volatileToken = null;
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // The retained user state still causes explicit recovery on the next request.
  }
}

function validToken(token: CachedToken | null): token is CachedToken {
  return !!token && token.expiresAt - TOKEN_EXPIRY_BUFFER_MS > Date.now();
}

async function fetchGoogleUser(accessToken: string): Promise<AuthUser> {
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Google profile request failed (${response.status}).`);
  }
  const profile = await response.json() as {
    name?: string;
    email?: string;
  };
  if (!profile.email) {
    throw new Error('Google did not return an email address for the signed-in user.');
  }
  return {
    displayName: profile.name || profile.email,
    email: profile.email,
  };
}

export function useGoogleAuthClient(enabled: boolean): AuthClient {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [initializationFailed, setInitializationFailed] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(readCachedUser);

  const prepare = useCallback(async (): Promise<void> => {
    setInitializationFailed(false);
    try {
      await loadGoogleIdentityServices();
      setReady(true);
    } catch (error) {
      setInitializationFailed(true);
      throw error;
    }
  }, []);

  useEffect(() => {
    if (!enabled || !clientId) return;
    let cancelled = false;
    void loadGoogleIdentityServices()
      .then(() => {
        if (!cancelled) {
          setInitializationFailed(false);
          setReady(true);
        }
      })
      .catch(error => {
        if (!cancelled) {
          setInitializationFailed(true);
          console.error('Failed to initialize Google sign-in:', error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, enabled]);

  const requestToken = useCallback(async (prompt = ''): Promise<string> => {
    if (!enabled || !clientId) {
      throw new Error(
        'Google sign-in is not configured. Set NEXT_PUBLIC_GOOGLE_CLIENT_ID to enable it.',
      );
    }

    setBusy(true);
    try {
      await loadGoogleIdentityServices();
      setInitializationFailed(false);
      setReady(true);
      const oauth2 = window.google?.accounts.oauth2;
      if (!oauth2) throw new Error('Google OAuth is unavailable.');

      const response = await new Promise<GoogleTokenResponse>((resolve, reject) => {
        const tokenClient = oauth2.initTokenClient({
          client_id: clientId,
          scope: GOOGLE_SCOPES,
          callback: resolve,
          error_callback: error => reject(
            new Error(error.message || error.type || 'Google sign-in failed.'),
          ),
        });
        tokenClient.requestAccessToken({ prompt });
      });

      if (response.error || !response.access_token) {
        throw new Error(
          response.error_description || response.error || 'Google did not return an access token.',
        );
      }
      const token: CachedToken = {
        accessToken: response.access_token,
        expiresAt: Date.now() + Math.max(0, response.expires_in || 3600) * 1000,
      };
      writeCachedToken(token);
      try {
        const nextUser = await fetchGoogleUser(token.accessToken);
        writeCachedUser(nextUser);
        setUser(nextUser);
      } catch (error) {
        clearGoogleSession();
        setUser(null);
        throw error;
      }
      return token.accessToken;
    } finally {
      setBusy(false);
    }
  }, [clientId, enabled]);

  const acquireToken = useCallback(async (options?: AcquireTokenOptions): Promise<string> => {
    const cached = readCachedToken();
    if (validToken(cached)) return cached.accessToken;
    if (options?.silentOnly) {
      throw new InteractiveAuthenticationRequiredError(
        new Error('Google access token expired or is unavailable.'),
      );
    }
    return requestToken('');
  }, [requestToken]);

  const invalidateToken = useCallback(() => {
    clearGoogleToken();
  }, []);

  const login = useCallback(async (): Promise<void> => {
    await requestToken('select_account');
  }, [requestToken]);

  const logout = useCallback(async (): Promise<void> => {
    // The cached book list belongs to the account signing out; a different
    // account signing in on this provider must not see it.
    clearCachedBooks();
    const cached = readCachedToken();
    clearGoogleSession();
    setUser(null);
    if (!cached?.accessToken) return;
    try {
      await loadGoogleIdentityServices();
      const oauth2 = window.google?.accounts.oauth2;
      if (!oauth2) return;
      await new Promise<void>(resolve => {
        oauth2.revoke(cached.accessToken, resolve);
      });
    } catch (error) {
      console.warn('Google token revocation failed after local logout:', error);
    }
  }, []);

  const getUser = useCallback(() => user, [user]);

  return useMemo<AuthClient>(() => ({
    provider: 'google',
    ready,
    isAuthenticated: !!user,
    busy: busy || (!ready && !initializationFailed),
    prepare,
    acquireToken,
    invalidateToken,
    login,
    logout,
    getUser,
  }), [
    user,
    ready,
    busy,
    initializationFailed,
    prepare,
    acquireToken,
    invalidateToken,
    login,
    logout,
    getUser,
  ]);
}
