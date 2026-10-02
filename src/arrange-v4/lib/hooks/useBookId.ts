'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useStore } from '@/lib/store/useStore';
import { authProviderForBackend, normalizeBookId, parseBookId } from '@/lib/store/types';
import type { Book, StoreOperationOptions } from '@/lib/store/types';
import { getLastBookId, setLastBookId, clearLastBookId } from '@/lib/bookStorage';
import { useAuthClient } from '@/lib/auth/useAuthClient';
import { isInteractiveAuthenticationRequiredError } from '@/lib/auth/errors';
import { useHydrated } from './useHydrated';
import { resolveBookRedirect } from './bookRedirect';

/**
 * Shared hook for resolving the selected book.
 * Reads bookId from search params, falls back to localStorage,
 * fetches books from the store, validates the bookId, and provides
 * a book-switcher helper.
 *
 * Backward compat: unprefixed IDs (from URLs/localStorage created before the
 * storage abstraction landed) are accepted and normalized on read. URL params
 * are also redirected to their prefixed form so the canonical shape wins.
 *
 * @param routePrefix  The route path prefix for this page (e.g. '/matrix', '/cancelled').
 */
export function useBookId(routePrefix: string) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const rawBookId = searchParams.get('bookId');
  const { isAuthenticated, busy, provider } = useAuthClient();
  const hydrated = useHydrated();
  const normalizedBookId = normalizeBookId(rawBookId);
  const normalizedBackend = normalizedBookId
    ? parseBookId(normalizedBookId)?.backend
    : undefined;
  const bookId = normalizedBackend && authProviderForBackend(normalizedBackend) === provider
    ? normalizedBookId
    : null;
  const store = useStore();

  const [books, setBooks] = useState<Book[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [authRecoveryRequired, setAuthRecoveryRequired] = useState(false);
  const fetchSequenceRef = useRef(0);

  // Normalize unprefixed URL bookIds to their prefixed form for canonical URLs.
  useEffect(() => {
    if (rawBookId && normalizedBookId && rawBookId !== normalizedBookId) {
      router.replace(`${routePrefix}?bookId=${encodeURIComponent(normalizedBookId)}`);
    }
  }, [rawBookId, normalizedBookId, router, routePrefix]);

  // Redirect logic: distinguish missing URL param from invalid URL param.
  // Only fall back to saved-book localStorage when there's no `?bookId` at
  // all. An invalid value (present but unknown prefix) must not silently load
  // a different book — that's misleading. Send to /books in that case.
  //
  // Gated on hydration: `provider` comes from localStorage, which the
  // statically pre-rendered HTML cannot read. Acting on the build-time
  // placeholder would bounce every Google-backed board to /books on reload
  // and on any deep link.
  useEffect(() => {
    const redirect = resolveBookRedirect({
      hydrated,
      rawBookId,
      normalizedBookId,
      savedBookId: hydrated ? getLastBookId(store.activeBackend) : null,
      provider,
      routePrefix,
    });
    if (redirect.kind === 'replace') {
      router.replace(redirect.href);
    }
  }, [
    hydrated,
    rawBookId,
    normalizedBookId,
    provider,
    router,
    routePrefix,
    store.activeBackend,
  ]);

  const fetchBooks = useCallback(async (
    options: StoreOperationOptions = { interaction: 'silent-only' },
  ) => {
    const fetchSequence = ++fetchSequenceRef.current;
    if (!isAuthenticated || busy) return false;
    setError(null);
    try {
      const all = await store.listBooks(options);
      if (fetchSequenceRef.current !== fetchSequence) return false;
      setBooks(all);
      setAuthRecoveryRequired(false);

      if (bookId && !all.some(b => b.id === bookId)) {
        clearLastBookId(store.activeBackend);
        router.replace('/books');
      } else if (bookId) {
        setLastBookId(bookId);
      }
      return true;
    } catch (err: unknown) {
      if (fetchSequenceRef.current !== fetchSequence) return false;
      if (
        options.interaction === 'silent-only' &&
        isInteractiveAuthenticationRequiredError(err)
      ) {
        setAuthRecoveryRequired(true);
        setError(null);
        return false;
      }
      const message = err instanceof Error ? err.message : 'Failed to fetch books';
      console.error('Error fetching books:', err);
      setAuthRecoveryRequired(options.interaction === 'allow-interactive');
      setError(message);
      return false;
    }
  }, [isAuthenticated, busy, store, bookId, router]);

  useEffect(() => {
    fetchBooks(); // eslint-disable-line react-hooks/set-state-in-effect -- async data fetching sets state after await
  }, [fetchBooks]);

  const handleBookSwitch = useCallback((nextBookId: string) => {
    router.push(`${routePrefix}?bookId=${encodeURIComponent(nextBookId)}`);
  }, [router, routePrefix]);

  const currentBook = books.find(b => b.id === bookId);
  const currentBookName = currentBook ? currentBook.name : bookId;

  return {
    bookId,
    books,
    currentBookName,
    handleBookSwitch,
    fetchBooks,
    authRecoveryRequired,
    error,
    setError,
  };
}
