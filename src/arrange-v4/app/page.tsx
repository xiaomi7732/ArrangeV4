'use client';

import { useMsal } from '@azure/msal-react';
import { loginRequest } from '@/lib/msalConfig';
import { useRouter } from 'next/navigation';
import { getCalendars } from '@/lib/graphService';
import { filterArrangeCalendars } from '@/lib/calendarUtils';
import { getLastBookId } from '@/lib/bookStorage';
import { useState, useEffect } from 'react';
import styles from './page.module.css';

/**
 * Determines the appropriate landing page after user authentication
 * @returns The path to navigate to after login
 */
async function getPostLoginRoute(accessToken: string): Promise<string> {
  try {
    const calendars = await getCalendars(accessToken);
    const arrangeCalendars = filterArrangeCalendars(calendars);
    
    if (arrangeCalendars.length === 1 && arrangeCalendars[0].id) {
      return `/matrix?bookId=${encodeURIComponent(arrangeCalendars[0].id)}`;
    }

    const savedBookId = getLastBookId();
    if (savedBookId && arrangeCalendars.some(cal => cal.id === savedBookId)) {
      return `/matrix?bookId=${encodeURIComponent(savedBookId)}`;
    }
  } catch (error) {
    console.error('Error fetching calendars for route decision:', error);
  }
  
  return '/books';
}

/**
 * Checks if the matrix view should be available
 */
async function shouldShowMatrixButton(accessToken: string): Promise<{ show: boolean; bookId?: string }> {
  try {
    const calendars = await getCalendars(accessToken);
    const arrangeCalendars = filterArrangeCalendars(calendars);
    
    if (arrangeCalendars.length === 1 && arrangeCalendars[0].id) {
      return { show: true, bookId: arrangeCalendars[0].id };
    }

    const savedBookId = getLastBookId();
    if (savedBookId && arrangeCalendars.some(cal => cal.id === savedBookId)) {
      return { show: true, bookId: savedBookId };
    }
  } catch (error) {
    console.error('Error checking matrix availability:', error);
  }
  
  return { show: false };
}

export default function Home() {
  const { instance, accounts, inProgress } = useMsal();
  const router = useRouter();
  const [matrixAvailable, setMatrixAvailable] = useState<{ show: boolean; bookId?: string }>({ show: false });

  const isAuthenticated = accounts.length > 0;

  useEffect(() => {
    const checkMatrixAvailability = async () => {
      if (isAuthenticated && accounts[0]) {
        try {
          const response = await instance.acquireTokenSilent({
            ...loginRequest,
            account: accounts[0],
          });
          const result = await shouldShowMatrixButton(response.accessToken);
          setMatrixAvailable(result);
        } catch (error) {
          console.error('Error checking matrix availability:', error);
        }
      }
    };

    checkMatrixAvailability();
  }, [isAuthenticated, accounts, instance]);

  const handleLogin = async () => {
    try {
      const result = await instance.loginPopup(loginRequest);
      const accessToken = result.accessToken;
      const route = await getPostLoginRoute(accessToken);
      router.push(route);
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
                    onClick={() => router.push(`/scrum?bookId=${encodeURIComponent(matrixAvailable.bookId!)}`)}
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
