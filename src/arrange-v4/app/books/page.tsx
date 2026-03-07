'use client';

import { useState, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '@/lib/msalConfig';
import { getCalendars, getUserInfo, createCalendar, deleteCalendar, Calendar } from '@/lib/graphService';
import CalendarList from '@/components/CalendarList';
import CreateCalendar from '@/components/CreateCalendar';
import styles from './page.module.css';

export default function BooksPage() {
  const { instance, accounts, inProgress } = useMsal();
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>('');

  const isAuthenticated = accounts.length > 0;

  const handleLogin = async () => {
    try {
      await instance.loginPopup(loginRequest);
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
      const account = accounts[0];
      const response = await instance.acquireTokenSilent({
        ...loginRequest,
        account: account,
      });

      // Fetch user info
      const userInfo = await getUserInfo(response.accessToken);
      setUserName(userInfo.displayName || userInfo.userPrincipalName || '');

      // Fetch calendars and filter those ending with "by arrange"
      const calendarsData = await getCalendars(response.accessToken);
      const filteredCalendars = calendarsData.filter(
        (calendar) => calendar.name?.toLowerCase().endsWith(' by arrange')
      );
      setCalendars(filteredCalendars);
    } catch (error: any) {
      console.error('Error fetching calendars:', error);
      setError(error.message || 'Failed to fetch books');
      
      // If token acquisition fails, try interactive login
      if (error.name === 'InteractionRequiredAuthError') {
        try {
          const response = await instance.acquireTokenPopup(loginRequest);
          const calendarsData = await getCalendars(response.accessToken);
          const filteredCalendars = calendarsData.filter(
            (calendar) => calendar.name?.toLowerCase().endsWith('by arrange')
          );
          setCalendars(filteredCalendars);
        } catch (popupError: any) {
          setError(popupError.message || 'Failed to fetch books');
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCreateCalendar = async (name: string) => {
    try {
      const account = accounts[0];
      const response = await instance.acquireTokenSilent({
        ...loginRequest,
        account: account,
      });

      const newCalendar = await createCalendar(response.accessToken, name);
      setCalendars(prev => [...prev, newCalendar]);
    } catch (error: any) {
      console.error('Error creating calendar:', error);
      throw new Error(error.message || 'Failed to create book');
    }
  };

  const handleDeleteCalendar = async (calendarId: string) => {
    try {
      const account = accounts[0];
      const response = await instance.acquireTokenSilent({
        ...loginRequest,
        account: account,
      });

      await deleteCalendar(response.accessToken, calendarId);
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
          <div className={styles.card}>
            <CalendarList 
              calendars={calendars} 
              loading={loading} 
              error={error}
              onDeleteCalendar={handleDeleteCalendar}
            />
          </div>
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
