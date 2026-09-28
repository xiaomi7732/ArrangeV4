'use client';

import { useState, useEffect } from 'react';
import { useStore } from '@/lib/store/useStore';
import type { Book } from '@/lib/store/types';
import { useAuthClient } from '@/lib/auth/useAuthClient';
import { useSetTopBarActions } from '@/components/TopBarProvider';
import CalendarList from '@/components/CalendarList';
import CreateCalendar from '@/components/CreateCalendar';
import styles from './page.module.css';

export default function BooksPage() {
  const auth = useAuthClient();
  const { isAuthenticated, busy } = auth;
  const store = useStore();
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const fetchBooks = async () => {
    if (!isAuthenticated) return;

    setLoading(true);
    setError(null);

    try {
      const user = auth.getUser();
      setUserName(user?.displayName || user?.email || '');

      const allBooks = await store.listBooks();
      setBooks(allBooks);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch books';
      console.error('Error fetching books:', err);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBook = async (name: string) => {
    try {
      const newBook = await store.createBook(name, { backend: 'calendar' });
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
      fetchBooks();
    }
  }, [isAuthenticated, busy]);

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
    ) : (
      <>
        <CreateCalendar
          onCreateCalendar={handleCreateBook}
          disabled={loading}
        />
        <button
          onClick={fetchBooks}
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
    [isAuthenticated, busy, loading],
  );

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
              This application uses Microsoft authentication to securely access your books.
            </p>
            <button
              onClick={handleLogin}
              disabled={busy}
              className={`${styles.button} ${styles.buttonPrimary}`}
            >
              {busy ? 'Signing in...' : 'Sign In with Microsoft'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
