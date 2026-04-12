'use client';

import { useState, useEffect } from 'react';
import { getCalendars, getUserInfo, createCalendar, deleteCalendar, Calendar } from '@/lib/graphService';
import { filterArrangeCalendars } from '@/lib/calendarUtils';
import { useGraphToken } from '@/lib/hooks/useGraphToken';
import CalendarList from '@/components/CalendarList';
import CreateCalendar from '@/components/CreateCalendar';
import styles from './page.module.css';

export default function BooksPage() {
  const { acquireToken, isAuthenticated, inProgress, handleLogin: graphLogin, instance } = useGraphToken();
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>('');

  const handleLogin = async () => {
    try {
      await graphLogin();
    } catch (error) {
      console.error('Login failed:', error);
      setError('Login failed. Please try again.');
    }
  };

  const handleLogout = () => {
    instance.logoutPopup({
      postLogoutRedirectUri: '/',
    });
  };

  const fetchCalendars = async () => {
    if (!isAuthenticated) return;

    setLoading(true);
    setError(null);

    try {
      const accessToken = await acquireToken();

      // Fetch user info
      const userInfo = await getUserInfo(accessToken);
      setUserName(userInfo.displayName || userInfo.userPrincipalName || '');

      // Fetch calendars and filter arrange books
      const calendarsData = await getCalendars(accessToken);
      const filteredCalendars = filterArrangeCalendars(calendarsData);
      setCalendars(filteredCalendars);
    } catch (error: any) {
      console.error('Error fetching calendars:', error);
      setError(error.message || 'Failed to fetch books');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateCalendar = async (name: string) => {
    try {
      const accessToken = await acquireToken();
      const newCalendar = await createCalendar(accessToken, name);
      setCalendars(prev => [...prev, newCalendar]);
    } catch (error: any) {
      console.error('Error creating calendar:', error);
      throw new Error(error.message || 'Failed to create book');
    }
  };

  const handleDeleteCalendar = async (calendarId: string) => {
    try {
      const accessToken = await acquireToken();
      await deleteCalendar(accessToken, calendarId);
      setCalendars(prev => prev.filter(c => c.id !== calendarId));
    } catch (error: any) {
      console.error('Error deleting calendar:', error);
      throw new Error(error.message || 'Failed to delete book');
    }
  };

  useEffect(() => {
    if (isAuthenticated && inProgress === 'none') {
      fetchCalendars();
    }
  }, [isAuthenticated, inProgress]);

  return (
    <div className={styles.container}>
      <div className={styles.inner}>
        <div className={styles.card}>
          <div className={styles.header}>
            <div>
              <h1 className={styles.title}>My Books</h1>
              {userName && (
                <p className={styles.welcome}>Welcome, {userName}</p>
              )}
            </div>
            <div className={styles.actions}>
              {!isAuthenticated ? (
                <button
                  onClick={handleLogin}
                  disabled={inProgress !== 'none'}
                  className={`${styles.button} ${styles.buttonPrimary}`}
                >
                  {inProgress !== 'none' ? 'Signing in...' : 'Sign In'}
                </button>
              ) : (
                <>
                  <CreateCalendar 
                    onCreateCalendar={handleCreateCalendar}
                    disabled={loading}
                  />
                  <button
                    onClick={fetchCalendars}
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
              )}
            </div>
          </div>
        </div>

        {isAuthenticated ? (
          <>
            <div className={styles.instructions}>
              <p className={styles.instructionsText}>
                A <strong>book</strong> is where your tasks live. Pick a book below to open its Eisenhower Matrix, or create a new one to get started.
              </p>
            </div>
            <div className={styles.card}>
              <CalendarList 
                calendars={calendars} 
                loading={loading} 
                error={error}
                onDeleteCalendar={handleDeleteCalendar}
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
              disabled={inProgress !== 'none'}
              className={`${styles.button} ${styles.buttonPrimary}`}
            >
              {inProgress !== 'none' ? 'Signing in...' : 'Sign In with Microsoft'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
