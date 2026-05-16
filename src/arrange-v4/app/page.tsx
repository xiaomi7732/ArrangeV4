'use client';

import { useMsal } from '@azure/msal-react';
import { loginRequest } from '@/lib/msalConfig';
import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store/useStore';
import { MultiBackendStore } from '@/lib/store/multiStore';
import { normalizeBookId } from '@/lib/store/types';
import { getLastBookId } from '@/lib/bookStorage';
import { useState, useEffect } from 'react';
import styles from './page.module.css';

export default function Home() {
  const { instance, accounts, inProgress } = useMsal();
  const router = useRouter();
  const store = useStore();
  const [matrixAvailable, setMatrixAvailable] = useState<{ show: boolean; bookId?: string }>({ show: false });

  const isAuthenticated = accounts.length > 0;

  useEffect(() => {
    const check = async () => {
      if (!isAuthenticated || !accounts[0]) return;
      try {
        const books = await store.listBooks();

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
        console.error('Error checking matrix availability:', error);
      }
    };

    check();
  }, [isAuthenticated, accounts, store]);

  const handleLogin = async () => {
    try {
      const result = await instance.loginPopup(loginRequest);
      // MSAL's React state hasn't re-rendered yet — useGraphToken would still
      // return a stale closure that throws "no account". Build a one-shot store
      // bound to the access token we just got back from loginPopup.
      const postLoginStore = new MultiBackendStore({
        acquireToken: async () => result.accessToken,
      });
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
