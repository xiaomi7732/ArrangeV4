'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store/useStore';
import type { Book, StoreOperationOptions } from '@/lib/store/types';
import { useAuthClient } from '@/lib/auth/useAuthClient';
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
    if (!isAuthenticated) return;

    setLoading(true);
    setError(null);

    try {
      const user = auth.getUser();
      setUserName(user?.displayName || user?.email || '');

      const allBooks = await store.listBooks(options);
      setBooks(allBooks);
      setAuthRecoveryRequired(false);
    } catch (err: unknown) {
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
      setLoading(false);
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
      const newBook = await store.createBook(name, {
        backend: backendForAuthProvider(auth.provider),
      });
      setBooks(prev => [...prev, newBook]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create book';
      console.error('Error creating book:', err);
      throw new Error(message);
    }
  };

  const handleDeleteBook = async (bookId: string) => {
    try {
      await store.deleteBook(bookId);
      setBooks(prev => prev.filter(b => b.id !== bookId));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete book';
      console.error('Error deleting book:', err);
      throw new Error(message);
    }
  };

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
    [isAuthenticated, authRecoveryRequired, busy, loading],
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
