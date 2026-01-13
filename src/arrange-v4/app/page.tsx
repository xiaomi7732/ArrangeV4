'use client';

import { useState, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '@/lib/msalConfig';
import { getCalendars, getUserInfo, Calendar } from '@/lib/graphService';
import CalendarList from '@/components/CalendarList';

export default function Home() {
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
      setError(error.message || 'Failed to fetch calendars');
      
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
          setError(popupError.message || 'Failed to fetch calendars');
        }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated && inProgress === 'none') {
      fetchCalendars();
    }
  }, [isAuthenticated, inProgress]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Arrange V4 - Calendar Viewer</h1>
              {userName && (
                <p className="text-gray-600 mt-2">Welcome, {userName}</p>
              )}
            </div>
            <div>
              {!isAuthenticated ? (
                <button
                  onClick={handleLogin}
                  disabled={inProgress !== 'none'}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-6 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {inProgress !== 'none' ? 'Signing in...' : 'Sign In'}
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={fetchCalendars}
                    disabled={loading}
                    className="bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-6 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {loading ? 'Loading...' : 'Refresh Calendars'}
                  </button>
                  <button
                    onClick={handleLogout}
                    className="bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-6 rounded-lg transition-colors"
                  >
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {isAuthenticated ? (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <CalendarList calendars={calendars} loading={loading} error={error} />
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-lg p-12 text-center">
            <h2 className="text-2xl font-semibold text-gray-700 mb-4">
              Sign in to view your calendars
            </h2>
            <p className="text-gray-600 mb-6">
              This application uses Microsoft authentication to securely access your Microsoft 365 calendars.
            </p>
            <button
              onClick={handleLogin}
              disabled={inProgress !== 'none'}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-8 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {inProgress !== 'none' ? 'Signing in...' : 'Sign In with Microsoft'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
