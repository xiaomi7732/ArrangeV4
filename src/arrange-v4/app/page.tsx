'use client';

import { useMsal } from '@azure/msal-react';
import { loginRequest } from '@/lib/msalConfig';
import { useRouter } from 'next/navigation';
import { getCalendars } from '@/lib/graphService';

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
    if (arrangeCalendars.length === 1) {
      return '/matrix';
    }
  } catch (error) {
    console.error('Error fetching calendars for route decision:', error);
  }
  
  // Default to books
  return '/books';
}

export default function Home() {
  const { instance, accounts, inProgress } = useMsal();
  const router = useRouter();

  const isAuthenticated = accounts.length > 0;

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
              <button
                onClick={handleNavigateToBooks}
                className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-8 rounded-lg transition-colors text-lg"
              >
                Go to My Books
              </button>
            )}
          </div>
        </div>


      </div>
    </div>

  );
}
