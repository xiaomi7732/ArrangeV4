'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useStore } from '@/lib/store/useStore';
import { normalizeBookId } from '@/lib/store/types';
import type { Book } from '@/lib/store/types';
import { getLastBookId, setLastBookId, clearLastBookId } from '@/lib/bookStorage';
import { useGraphToken } from './useGraphToken';

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
  const bookId = normalizeBookId(rawBookId);

  const { isAuthenticated, inProgress } = useGraphToken();
  const store = useStore();

  const [books, setBooks] = useState<Book[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Normalize unprefixed URL bookIds to their prefixed form for canonical URLs.
  useEffect(() => {
    if (rawBookId && bookId && rawBookId !== bookId) {
      router.replace(`${routePrefix}?bookId=${encodeURIComponent(bookId)}`);
    }
  }, [rawBookId, bookId, router, routePrefix]);

  // Redirect logic: distinguish missing URL param from invalid URL param.
  // Only fall back to saved-book localStorage when there's no `?bookId` at
  // all. An invalid value (present but unknown prefix) must not silently load
  // a different book — that's misleading. Send to /books in that case.
  useEffect(() => {
    if (!rawBookId) {
      const saved = normalizeBookId(getLastBookId());
      if (saved) {
        router.replace(`${routePrefix}?bookId=${encodeURIComponent(saved)}`);
      }
    } else if (!bookId) {
      router.replace('/books');
    }
  }, [rawBookId, bookId, router, routePrefix]);

  const fetchBooks = useCallback(async () => {
    if (!isAuthenticated || inProgress !== 'none') return;
    setError(null);
    try {
      const all = await store.listBooks();
      setBooks(all);

      if (bookId && !all.some(b => b.id === bookId)) {
        clearLastBookId();
        router.replace('/books');
      } else if (bookId) {
        setLastBookId(bookId);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch books';
      console.error('Error fetching books:', err);
      setError(message);
    }
  }, [isAuthenticated, inProgress, store, bookId, router]);

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
    error,
    setError,
  };
}
