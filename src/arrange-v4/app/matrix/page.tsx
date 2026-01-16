'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '@/lib/msalConfig';
import { getCalendarEvents } from '@/lib/graphService';
import { createTodoItem, TodoItem, parseTodoData } from '@/lib/todoDataService';
import AddTodoItem from '@/components/AddTodoItem';

export default function MatrixPage() {
  const searchParams = useSearchParams();
  const bookId = searchParams.get('bookId');
  
  const { instance, accounts, inProgress } = useMsal();
  const [todoItems, setTodoItems] = useState<(TodoItem & { id?: string })[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAuthenticated = accounts.length > 0;

  const fetchEvents = async () => {
    if (!isAuthenticated || !bookId) return;

    setLoading(true);
    setError(null);

    try {
      const account = accounts[0];
      const response = await instance.acquireTokenSilent({
        ...loginRequest,
        account: account,
      });

      // Fetch events for the next 7 days
      const now = new Date();
      const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      
      const eventsData = await getCalendarEvents(
        response.accessToken,
        bookId,
        now.toISOString(),
        endDate.toISOString()
      );
      
      // Parse events to TodoItems
      const todos = eventsData.map(event => parseTodoData(event));
      setTodoItems(todos);
    } catch (error: any) {
      console.error('Error fetching events:', error);
      setError(error.message || 'Failed to fetch events');
    } finally {
      setLoading(false);
    }
  };

  const handleAddTodo = async (todoItem: TodoItem) => {
    if (!bookId) {
      throw new Error('No book selected');
    }

    try {
      const account = accounts[0];
      const response = await instance.acquireTokenSilent({
        ...loginRequest,
        account: account,
      });

      await createTodoItem(response.accessToken, bookId, todoItem);
      
      // Refresh the events list after creating
      await fetchEvents();
    } catch (error: any) {
      console.error('Error creating TODO item:', error);
      throw new Error(error.message || 'Failed to create TODO item');
    }
  };

  const handleLogin = async () => {
    try {
      await instance.loginPopup(loginRequest);
    } catch (error) {
      console.error('Login failed:', error);
      setError('Login failed. Please try again.');
    }
  };

  useEffect(() => {
    if (isAuthenticated && inProgress === 'none' && bookId) {
      fetchEvents();
    }
  }, [isAuthenticated, inProgress, bookId]);

  if (!bookId) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="container mx-auto">
          <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded">
            No calendar selected. Please select a calendar from the <a href="/books" className="text-blue-600 hover:underline">Books page</a>.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Matrix View</h1>
              <p className="text-gray-600 mt-1 text-sm font-mono">Calendar: {bookId}</p>
            </div>
            <div className="flex gap-2">
              {!isAuthenticated ? (
                <button
                  onClick={handleLogin}
                  disabled={inProgress !== 'none'}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-6 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {inProgress !== 'none' ? 'Signing in...' : 'Sign In'}
                </button>
              ) : (
                <>
                  <AddTodoItem onAddTodo={handleAddTodo} disabled={loading} />
                  <button
                    onClick={fetchEvents}
                    disabled={loading}
                    className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium py-2 px-4 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {loading ? 'Loading...' : 'Refresh'}
                  </button>
                </>
              )}
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4" role="alert">
              <strong className="font-bold">Error: </strong>
              <span>{error}</span>
            </div>
          )}

          {loading && (
            <div className="flex justify-center items-center p-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
          )}

          {!loading && isAuthenticated && todoItems.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              No TODO items found. Click "Add TODO" to create one.
            </div>
          )}

          {!loading && isAuthenticated && todoItems.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-gray-800">TODO Items ({todoItems.length})</h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {todoItems.map((todo) => (
                  <div
                    key={todo.id}
                    className="border rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow bg-white"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-semibold text-lg text-gray-900 flex-1">
                        {todo.subject}
                      </h3>
                      {(todo.urgent || todo.important) && (
                        <div className="flex gap-1 ml-2">
                          {todo.urgent && (
                            <span className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded font-semibold">
                              Urgent
                            </span>
                          )}
                          {todo.important && (
                            <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded font-semibold">
                              Important
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    
                    {todo.status && (
                      <p className="text-sm text-gray-600 mb-2">
                        Status: <span className="font-medium">{todo.status}</span>
                      </p>
                    )}
                    
                    {todo.etsDateTime && (
                      <p className="text-sm text-gray-600">
                        Start: {new Date(todo.etsDateTime).toLocaleString()}
                      </p>
                    )}
                    {todo.etaDateTime && (
                      <p className="text-sm text-gray-600">
                        End: {new Date(todo.etaDateTime).toLocaleString()}
                      </p>
                    )}
                    
                    {todo.categories && todo.categories.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {todo.categories.map((cat, idx) => (
                          <span
                            key={idx}
                            className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded"
                          >
                            {cat}
                          </span>
                        ))}
                      </div>
                    )}
                    
                    {todo.checklist && todo.checklist.length > 0 && (
                      <div className="mt-2 text-sm text-gray-600">
                        <p className="font-medium">Checklist:</p>
                        <ul className="list-none pl-0">
                          {todo.checklist.map((item, idx) => (
                            <li key={idx} className="text-xs">
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
