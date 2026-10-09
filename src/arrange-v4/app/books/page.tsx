'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store/useStore';
import type { Book, StoreOperationOptions } from '@/lib/store/types';
import { useAuthClient } from '@/lib/auth/useAuthClient';
import { insertBookSorted } from '@/lib/books/sortBooks';
import { cacheGeneration, clearCachedBooks, setCachedBooks } from '@/lib/books/bookListCache';
import { backendForAuthProvider } from '@/lib/store/types';
import { isInteractiveAuthenticationRequiredError } from '@/lib/auth/errors';
import { useSetTopBarActions } from '@/components/TopBarProvider';
import AuthRecoveryPanel from '@/components/AuthRecoveryPanel';
import CalendarList from '@/components/CalendarList';
import CreateCalendar from '@/components/CreateCalendar';
import styles from './page.module.css';

export default function BooksPage() {
  const auth = useAuthClient();
  const router = useRouter();
  const { isAuthenticated, busy } = auth;
  const store = useStore();
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authRecoveryRequired, setAuthRecoveryRequired] = useState(false);
  const [userName, setUserName] = useState<string>('');
  const fetchSequenceRef = useRef(0);
  // Bumped whenever this page changes the book list, or the account signs out:
  // a read in flight across such a change must not publish its stale answer.
  const publishEpochRef = useRef(0);

  const handleLogin = async () => {
    try {
      await auth.login();
    } catch (error) {
      console.error('Login failed:', error);
      setError('Login failed. Please try again.');
    }
  };

  const handleLogout = async () => {
    try {
      await auth.logout();
      router.push('/');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const fetchBooks = useCallback(async (
    options: StoreOperationOptions = { interaction: 'allow-interactive' },
  ) => {
    const fetchSequence = ++fetchSequenceRef.current;
    const publishEpoch = publishEpochRef.current;
    const generation = cacheGeneration();
    if (!isAuthenticated) return;

    setLoading(true);
    setError(null);

    try {
      const user = auth.getUser();
      const allBooks = await store.listBooks(options);
      if (fetchSequenceRef.current !== fetchSequence) return;
      // A create or delete that ran while this read was in flight makes its
      // answer obsolete, even though it is still the newest read.
      if (publishEpochRef.current !== publishEpoch) return;
      setCachedBooks(store.activeBackend, allBooks, generation);
      setUserName(user?.displayName || user?.email || '');
      setBooks(allBooks);
      setAuthRecoveryRequired(false);
    } catch (err: unknown) {
      if (fetchSequenceRef.current !== fetchSequence) return;
      if (
        options.interaction === 'silent-only' &&
        isInteractiveAuthenticationRequiredError(err)
      ) {
        setAuthRecoveryRequired(true);
        setError(null);
        return;
      }
      const message = err instanceof Error ? err.message : 'Failed to fetch books';
      console.error('Error fetching books:', err);
      setAuthRecoveryRequired(options.interaction === 'allow-interactive');
      setError(message);
    } finally {
      if (fetchSequenceRef.current === fetchSequence) {
        setLoading(false);
      }
    }
  }, [isAuthenticated, auth, store]);

  const handleAuthRecovery = async () => {
    if (isAuthenticated) {
      await fetchBooks();
      return;
    }
    await handleLogin();
  };

  const handleCreateBook = async (name: string) => {
    try {
      // The switcher on other pages renders from the cache while it refetches,
      // so a list this page is about to change must not survive the change —
      // and neither may a read that started before the change and lands after.
      publishEpochRef.current += 1;
      clearCachedBooks();
      const newBook = await store.createBook(name, {
        backend: backendForAuthProvider(auth.provider),
      });
      setBooks(prev => insertBookSorted(prev, newBook));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create book';
      console.error('Error creating book:', err);
      throw new Error(message);
    } finally {
      // A read that started *during* the change is just as obsolete.
      publishEpochRef.current += 1;
    }
  };

  const handleDeleteBook = async (bookId: string) => {
    try {
      publishEpochRef.current += 1;
      clearCachedBooks();
      await store.deleteBook(bookId);
      setBooks(prev => prev.filter(b => b.id !== bookId));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete book';
      console.error('Error deleting book:', err);
      throw new Error(message);
    } finally {
      publishEpochRef.current += 1;
    }
  };

  // Signing out ends the cache's usefulness and its right to exist: the next
  // account must not catch a glimpse of this one's books.
  useEffect(() => {
    if (isAuthenticated || busy) return;
    publishEpochRef.current += 1;
    clearCachedBooks();
    setBooks([]);
  }, [isAuthenticated, busy]);

  useEffect(() => {
    if (isAuthenticated && !busy) {
      void fetchBooks({ interaction: 'silent-only' });
    }
  }, [isAuthenticated, busy, fetchBooks]);

  useSetTopBarActions(
    null,
    !isAuthenticated ? (
      <button
        onClick={handleLogin}
        disabled={busy}
        className={`${styles.button} ${styles.buttonPrimary}`}
      >
        {busy ? 'Signing in...' : 'Sign In'}
      </button>
    ) : authRecoveryRequired ? null : (
      <>
        <CreateCalendar
          onCreateCalendar={handleCreateBook}
          disabled={loading}
          appendArrangeSuffix={auth.provider === 'microsoft'}
          existingNames={books.map(b => b.name)}
        />
        <button
          onClick={() => void fetchBooks()}
          disabled={loading}
          className={`${styles.button} ${styles.buttonSecondary}`}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
        <button
          onClick={handleLogout}
          className={`${styles.button} ${styles.buttonDanger}`}
        >
          Sign Out
        </button>
      </>
    ),
    [isAuthenticated, authRecoveryRequired, busy, loading, books, auth.provider],
  );

  if (authRecoveryRequired) {
    return (
      <div className={styles.container}>
        <div className={styles.inner}>
          <AuthRecoveryPanel
            busy={busy || loading}
            error={error}
            onLogin={handleAuthRecovery}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.inner}>
        {isAuthenticated ? (
          <>
            <div className={styles.instructions}>
              <p className={styles.instructionsText}>
                {userName && <><strong>{userName}</strong> — </>}
                Pick a book below to open its Eisenhower Matrix, or create a new one to get started.
              </p>
            </div>
            <div className={styles.card}>
              <CalendarList
                books={books}
                loading={loading}
                error={error}
                onDeleteBook={handleDeleteBook}
              />
            </div>
          </>
        ) : (
          <div className={styles.unauthCard}>
            <h2 className={styles.unauthTitle}>
              Sign in to view your books
            </h2>
            <p className={styles.unauthDescription}>
              Sign in again to securely access your {auth.provider === 'google' ? 'Google Sheets' : 'Microsoft Calendar'} books.
            </p>
            <button
              onClick={handleLogin}
              disabled={busy}
              className={`${styles.button} ${styles.buttonPrimary}`}
            >
              {busy ? 'Signing in...' : `Sign In with ${auth.provider === 'google' ? 'Google' : 'Microsoft'}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
