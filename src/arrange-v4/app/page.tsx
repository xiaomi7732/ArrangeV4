'use client';

import { useMsal } from '@azure/msal-react';
import { loginRequest } from '@/lib/msalConfig';
import { useRouter } from 'next/navigation';
import { getCalendars } from '@/lib/graphService';
import { useState, useEffect } from 'react';

/**
 * Determines the appropriate landing page after user authentication
 * @returns The path to navigate to after login
 */
async function getPostLoginRoute(accessToken: string): Promise<string> {
  try {
    const calendars = await getCalendars(accessToken);
    
    // Filter calendars that end with " by arrange"
    const arrangeCalendars = calendars.filter(cal => 
      cal.name?.endsWith(' by arrange')
    );
    
    // If there's exactly 1 calendar ending with " by arrange", go to matrix
    if (arrangeCalendars.length === 1 && arrangeCalendars[0].id) {
      return `/matrix?bookId=${arrangeCalendars[0].id}`;
    }
  } catch (error) {
    console.error('Error fetching calendars for route decision:', error);
  }
  
  // Default to books
  return '/books';
}

/**
 * Checks if the matrix view should be available
 */
async function shouldShowMatrixButton(accessToken: string): Promise<{ show: boolean; bookId?: string }> {
  try {
    const calendars = await getCalendars(accessToken);
    
    // Filter calendars that end with " by arrange"
    const arrangeCalendars = calendars.filter(cal => 
      cal.name?.endsWith(' by arrange')
    );
    
    // Show matrix button if there's exactly 1 calendar ending with " by arrange"
    if (arrangeCalendars.length === 1 && arrangeCalendars[0].id) {
      return { show: true, bookId: arrangeCalendars[0].id };
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
      router.push(`/matrix?bookId=${matrixAvailable.bookId}`);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h1 className="text-5xl font-bold text-gray-900 mb-4">
              Welcome to Arrange V4
            </h1>
          </div>
          <div>
            Arrange V4 is the only todo app that you need. Organize your tasks efficiently and boost your productivity.
          </div>
          <div className="text-center">
            {!isAuthenticated ? (
              <button
                onClick={handleLogin}
                disabled={inProgress !== 'none'}
                className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-8 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-lg"
              >
                {inProgress !== 'none' ? 'Signing in...' : 'Get Started - Sign In'}
              </button>
            ) : (
              <div className="space-x-4">
                <button
                  onClick={handleNavigateToBooks}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-8 rounded-lg transition-colors text-lg"
                >
                  Go to My Books
                </button>
                {matrixAvailable.show && (
                  <button
                    onClick={handleNavigateToMatrix}
                    className="bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-8 rounded-lg transition-colors text-lg"
                  >
                    Go to Matrix
                  </button>
                )}
              </div>
            )}
          </div>
        </div>


      </div>
    </div>

  );
}
