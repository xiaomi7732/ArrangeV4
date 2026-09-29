'use client';

import { useRouter } from 'next/navigation';
import { useAuthClient } from '@/lib/auth/useAuthClient';
import { useAuthProvider } from '@/lib/auth/AuthContext';
import type { AuthProvider } from '@/lib/auth/types';
import { useStore } from '@/lib/store/useStore';
import { normalizeBookId } from '@/lib/store/types';
import { getLastBookId } from '@/lib/bookStorage';
import { useState, useEffect } from 'react';
import styles from './page.module.css';

export default function Home() {
  const auth = useAuthClient();
  const {
    activeProvider,
    googleEnabled,
    googleReady,
    loginWithProvider,
  } = useAuthProvider();
  const store = useStore();
  const router = useRouter();
  const [matrixAvailable, setMatrixAvailable] = useState<{ show: boolean; bookId?: string }>({ show: false });

  const { isAuthenticated, busy } = auth;

  // Background availability check: silent-only token acquisition so we never
  // open an unexpected popup from a useEffect. If the silent acquisition fails
  // (e.g. the cached token expired and interaction is needed), we just don't
  // show the matrix buttons — the user can sign in via the Get Started button.
  // The `cancelled` flag prevents a slow listBooks() response from a previous
  // account from clobbering newer state if the user switches accounts mid-flight.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (!isAuthenticated) return;
      try {
        const books = await store.listBooks({ interaction: 'silent-only' });
        if (cancelled) return;

        if (books.length === 1) {
          setMatrixAvailable({ show: true, bookId: books[0].id });
          return;
        }

        const savedBookId = normalizeBookId(getLastBookId());
        if (savedBookId && books.some(b => b.id === savedBookId)) {
          setMatrixAvailable({ show: true, bookId: savedBookId });
          return;
        }

        setMatrixAvailable({ show: false });
      } catch (error) {
        if (cancelled) return;
        // Silent failure is fine for this background check — don't open a popup.
        // Reset matrixAvailable so stale data from a previous account or a
        // previously-successful check doesn't linger.
        setMatrixAvailable({ show: false });
        console.error('Error checking matrix availability:', error);
      }
    };

    check();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, auth, store]);

  const handleLogin = async (provider: AuthProvider) => {
    try {
      await loginWithProvider(provider);
      router.push('/books');
    } catch (error) {
      console.error('Login failed:', error);
    }
  };

  const handleNavigateToBooks = () => {
    router.push('/books');
  };

  const handleNavigateToMatrix = () => {
    if (matrixAvailable.bookId) {
      router.push(`/matrix?bookId=${encodeURIComponent(matrixAvailable.bookId)}`);
    }
  };

  const handleNavigateToScrum = () => {
    if (matrixAvailable.bookId) {
      router.push(`/scrum?bookId=${encodeURIComponent(matrixAvailable.bookId)}`);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Welcome to Arrange</h1>
        <p className={styles.description}>
          The only todo app you need. Organize your tasks with the Eisenhower Matrix and boost your productivity.
        </p>
        <div className={styles.actions}>
          {!isAuthenticated ? (
            <>
              <p className={styles.providerPrompt}>Choose where Arrange stores your books:</p>
              <button
                onClick={() => void handleLogin('microsoft')}
                disabled={activeProvider === 'microsoft' && busy}
                className={`${styles.button} ${styles.buttonPrimary}`}
              >
                {activeProvider === 'microsoft' && busy
                  ? 'Signing in...'
                  : 'Continue with Microsoft'}
              </button>
              {googleEnabled && (
                <button
                  onClick={() => void handleLogin('google')}
                  disabled={!googleReady || (activeProvider === 'google' && busy)}
                  className={`${styles.button} ${styles.buttonGoogle}`}
                >
                  {!googleReady
                    ? 'Loading Google sign-in...'
                    : activeProvider === 'google' && busy
                      ? 'Signing in...'
                      : 'Continue with Google'}
                </button>
              )}
            </>
          ) : (
            <>
              <button
                onClick={handleNavigateToBooks}
                className={`${styles.button} ${styles.buttonPrimary}`}
              >
                Go to My Books
              </button>
              {matrixAvailable.show && (
                <>
                  <button
                    onClick={handleNavigateToMatrix}
                    className={`${styles.button} ${styles.buttonSecondary}`}
                  >
                    Go to Matrix
                  </button>
                  <button
                    onClick={handleNavigateToScrum}
                    className={`${styles.button} ${styles.buttonSecondary}`}
                  >
                    Go to Scrum Board
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
