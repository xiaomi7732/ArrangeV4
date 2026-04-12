'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { getCalendars, Calendar } from '@/lib/graphService';
import { filterArrangeCalendars, getCalendarDisplayName } from '@/lib/calendarUtils';
import { getLastBookId, setLastBookId, clearLastBookId } from '@/lib/bookStorage';
import { useGraphToken } from './useGraphToken';

/**
 * Shared hook for resolving the selected book (calendar).
 * Reads bookId from search params, falls back to localStorage,
 * fetches arrange calendars, validates the bookId, and provides
 * a book-switcher helper.
 *
 * @param routePrefix  The route path prefix for this page (e.g. '/matrix', '/cancelled').
 *                     Used to build redirect URLs with the bookId query param.
 */
export function useBookId(routePrefix: string) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const bookId = searchParams.get('bookId');

  const { acquireToken, isAuthenticated } = useGraphToken();

  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Redirect to saved book if no bookId in URL
  useEffect(() => {
    if (!bookId) {
      const saved = getLastBookId();
      if (saved) {
        router.replace(`${routePrefix}?bookId=${encodeURIComponent(saved)}`);
      }
    }
  }, [bookId, router, routePrefix]);

  // Fetch calendars and validate bookId
  const fetchCalendars = useCallback(async () => {
    if (!isAuthenticated) return;
    setError(null);
    try {
      const accessToken = await acquireToken();
      const all = await getCalendars(accessToken);
      const arrangeCalendars = filterArrangeCalendars(all);
      setCalendars(arrangeCalendars);

      if (bookId && !arrangeCalendars.some(c => c.id === bookId)) {
        clearLastBookId();
        router.replace('/books');
      } else if (bookId) {
        setLastBookId(bookId);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch calendars';
      console.error('Error fetching calendars:', err);
      setError(message);
    }
  }, [isAuthenticated, acquireToken, bookId, router]);

  useEffect(() => {
    fetchCalendars(); // eslint-disable-line react-hooks/set-state-in-effect -- async data fetching sets state after await
  }, [fetchCalendars]);

  const handleCalendarSwitch = useCallback((calendarId: string) => {
    router.push(`${routePrefix}?bookId=${encodeURIComponent(calendarId)}`);
  }, [router, routePrefix]);

  const currentCalendar = calendars.find(c => c.id === bookId);
  const currentCalendarName = currentCalendar ? getCalendarDisplayName(currentCalendar) : bookId;

  return {
    bookId,
    calendars,
    currentCalendarName,
    handleCalendarSwitch,
    fetchCalendars,
    error,
    setError,
  };
}
