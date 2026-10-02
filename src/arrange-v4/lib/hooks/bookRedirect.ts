// Relative imports (not the `@/` alias): this module is compiled by
// tsconfig.test.json and run directly on Node, which does not resolve the
// path alias at runtime.
import {
  authProviderForBackend,
  normalizeBookId,
  parseBookId,
} from '../store/types';
import type { AuthProvider } from '../auth/types';

export type BookRedirect =
  | { kind: 'none' }
  | { kind: 'replace'; href: string };

const STAY: BookRedirect = { kind: 'none' };

export interface BookRedirectInput {
  /**
   * Whether the client has taken over from the statically pre-rendered HTML.
   * `provider` is read from `localStorage`, so before hydration it reports the
   * build-time placeholder rather than the user's actual provider.
   */
  hydrated: boolean;
  /** Raw `?bookId=` search param, if any. */
  rawBookId: string | null;
  /** `rawBookId` run through `normalizeBookId`, or null when it is unusable. */
  normalizedBookId: string | null;
  /** Last book remembered for the active backend, if any. */
  savedBookId: string | null;
  /** The currently active auth provider. */
  provider: AuthProvider;
  /** Route path for the current page, e.g. `/matrix`. */
  routePrefix: string;
}

function hrefFor(routePrefix: string, bookId: string): string {
  return `${routePrefix}?bookId=${encodeURIComponent(bookId)}`;
}

function matchesProvider(bookId: string, provider: AuthProvider): boolean {
  const backend = parseBookId(bookId)?.backend;
  return !!backend && authProviderForBackend(backend) === provider;
}

/**
 * Decides where a board page should send the user.
 *
 * Distinguishes a missing `?bookId=` from an invalid one: only a missing param
 * falls back to the remembered book. A present-but-unusable value must not
 * silently open a different book, so it goes to the book list instead.
 *
 * Returns no redirect until `hydrated`, because the provider check cannot be
 * trusted before then — see `useHydrated`.
 */
export function resolveBookRedirect(input: BookRedirectInput): BookRedirect {
  const {
    hydrated,
    rawBookId,
    normalizedBookId,
    savedBookId,
    provider,
    routePrefix,
  } = input;

  if (!hydrated) return STAY;

  if (!rawBookId) {
    const saved = normalizeBookId(savedBookId);
    if (saved && matchesProvider(saved, provider)) {
      return { kind: 'replace', href: hrefFor(routePrefix, saved) };
    }
    return STAY;
  }

  if (!normalizedBookId) return { kind: 'replace', href: '/books' };

  return matchesProvider(normalizedBookId, provider)
    ? STAY
    : { kind: 'replace', href: '/books' };
}
