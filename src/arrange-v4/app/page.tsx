'use client';

import { useMsal } from '@azure/msal-react';
import { loginRequest } from '@/lib/msalConfig';
import { useRouter } from 'next/navigation';
import { MultiBackendStore } from '@/lib/store/multiStore';
import { normalizeBookId } from '@/lib/store/types';
import { getLastBookId } from '@/lib/bookStorage';
import { useState, useEffect } from 'react';
import styles from './page.module.css';

export default function Home() {
  const { instance, accounts, inProgress } = useMsal();
  const router = useRouter();
  const [matrixAvailable, setMatrixAvailable] = useState<{ show: boolean; bookId?: string }>({ show: false });

  const isAuthenticated = accounts.length > 0;

  // Background availability check: silent-only token acquisition so we never
  // open an unexpected popup from a useEffect. If the silent acquisition fails
  // (e.g. the cached token expired and interaction is needed), we just don't
  // show the matrix buttons — the user can sign in via the Get Started button.
  useEffect(() => {
    const check = async () => {
      if (!isAuthenticated || !accounts[0]) return;
      try {
        const response = await instance.acquireTokenSilent({
          ...loginRequest,
          account: accounts[0],
        });
        const silentStore = new MultiBackendStore({
          acquireToken: async () => response.accessToken,
        });
        const books = await silentStore.listBooks();

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
        // Silent failure is fine for this background check — don't open a popup.
        // But reset matrixAvailable so stale data from a previous account or
        // a previously-successful check doesn't linger.
        setMatrixAvailable({ show: false });
        console.error('Error checking matrix availability:', error);
      }
    };

    check();
  }, [isAuthenticated, accounts, instance]);

  const handleLogin = async () => {
    try {
      const result = await instance.loginPopup(loginRequest);

      // MSAL's React state hasn't re-rendered yet — useGraphToken would still
      // return a stale closure that throws "no account". Build a one-shot store
      // bound to the access token we just got back from loginPopup.
      const postLoginStore = new MultiBackendStore({
        acquireToken: async () => result.accessToken,
      });

      // Wrap the post-login routing decision in its own try/catch. A transient
      // Graph error must not leave the user stuck on the landing page after a
      // successful login — fall back to /books in that case.
      try {
        const books = await postLoginStore.listBooks();

        if (books.length === 1) {
          router.push(`/matrix?bookId=${encodeURIComponent(books[0].id)}`);
          return;
        }

        const savedBookId = normalizeBookId(getLastBookId());
        if (savedBookId && books.some(b => b.id === savedBookId)) {
          router.push(`/matrix?bookId=${encodeURIComponent(savedBookId)}`);
          return;
        }
      } catch (routingError) {
        console.error('Error during post-login routing — falling back to /books:', routingError);
      }

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
            <button
              onClick={handleLogin}
              disabled={inProgress !== 'none'}
              className={`${styles.button} ${styles.buttonPrimary}`}
            >
              {inProgress !== 'none' ? 'Signing in...' : 'Get Started'}
            </button>
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
