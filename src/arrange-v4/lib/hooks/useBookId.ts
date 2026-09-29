'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useStore } from '@/lib/store/useStore';
import { authProviderForBackend, normalizeBookId, parseBookId } from '@/lib/store/types';
import type { Book, StoreOperationOptions } from '@/lib/store/types';
import { getLastBookId, setLastBookId, clearLastBookId } from '@/lib/bookStorage';
import { useAuthClient } from '@/lib/auth/useAuthClient';
import { useAuthProvider } from '@/lib/auth/AuthContext';
import { isInteractiveAuthenticationRequiredError } from '@/lib/auth/errors';

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
  const { selectProvider } = useAuthProvider();
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
  useEffect(() => {
    if (!rawBookId) {
      const saved = normalizeBookId(getLastBookId());
      const savedBackend = saved ? parseBookId(saved)?.backend : undefined;
      if (saved && savedBackend && authProviderForBackend(savedBackend) === provider) {
        router.replace(`${routePrefix}?bookId=${encodeURIComponent(saved)}`);
      }
    } else if (!normalizedBookId) {
      router.replace('/books');
    } else {
      const backend = parseBookId(normalizedBookId)?.backend;
      if (backend && authProviderForBackend(backend) !== provider) {
        clearLastBookId();
        try {
          selectProvider(authProviderForBackend(backend));
        } catch (providerError) {
          console.error('Unable to select the book provider:', providerError);
          router.replace('/');
        }
      }
    }
  }, [
    rawBookId,
    normalizedBookId,
    provider,
    router,
    routePrefix,
    selectProvider,
  ]);

  const fetchBooks = useCallback(async (
    options: StoreOperationOptions = { interaction: 'silent-only' },
  ) => {
    if (!isAuthenticated || busy) return false;
    setError(null);
    try {
      const all = await store.listBooks(options);
      setBooks(all);
      setAuthRecoveryRequired(false);

      if (bookId && !all.some(b => b.id === bookId)) {
        clearLastBookId();
        router.replace('/books');
      } else if (bookId) {
        setLastBookId(bookId);
      }
      return true;
    } catch (err: unknown) {
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
