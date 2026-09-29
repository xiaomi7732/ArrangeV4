/**
 * Authentication abstraction.
 *
 * Today the only provider is Microsoft (MSAL). The interface is designed to
 * accept additional providers (e.g. Google Identity Services) without
 * touching consumers.
 */

export type AuthProvider = 'microsoft' | 'google';

export const ALL_AUTH_PROVIDERS: AuthProvider[] = ['microsoft', 'google'];

export interface AuthUser {
  /** Human-friendly name for display. Always present (falls back to email if no name is set). */
  displayName: string;
  /** Email address / UPN if the provider exposes one. */
  email?: string;
}

export interface AcquireTokenOptions {
  /** Never start an interactive flow when silent acquisition fails. */
  silentOnly?: boolean;
}

export interface AuthClient {
  /** Which provider this client implements. */
  readonly provider: AuthProvider;
  /** True when the provider SDK is ready to service user actions. */
  readonly ready: boolean;
  /** True when a user is signed in. */
  readonly isAuthenticated: boolean;
  /** True when login, logout, or token acquisition is in progress. */
  readonly busy: boolean;

  /**
   * Acquires an access token suitable for the corresponding backend's API.
   * Implementations should attempt silent acquisition first and fall back to
   * an interactive popup only when necessary.
   *
   * Pass `{ silentOnly: true }` to disable the popup fallback — useful for
   * background checks (e.g. from a `useEffect`) where an unexpected popup
   * would be a poor UX.
   */
  acquireToken(options?: AcquireTokenOptions): Promise<string>;
  /** Discards a cached access token after an API reports it is unusable. */
  invalidateToken(): void;

  /** Starts an interactive sign-in flow. */
  login(): Promise<void>;

  /** Signs the current user out and clears any cached state. */
  logout(): Promise<void>;

  /** Returns the signed-in user, or null when not signed in. */
  getUser(): AuthUser | null;
}
