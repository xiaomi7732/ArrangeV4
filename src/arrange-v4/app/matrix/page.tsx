'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '@/lib/msalConfig';
import { getCalendarEvents } from '@/lib/graphService';
import { createTodoItem, updateTodoItem, TodoItem, parseTodoData } from '@/lib/todoDataService';
import AddTodoItem from '@/components/AddTodoItem';
import styles from './page.module.css';

// TodoCard component for rendering individual todo items
function TodoCard({ todo, onDragStart }: { todo: TodoItem & { id?: string }, onDragStart?: (todo: TodoItem & { id?: string }) => void }) {
  return (
    <div 
      className={styles.todoCard}
      draggable={!!todo.id}
      onDragStart={() => onDragStart?.(todo)}
    >
      <div className={styles.todoHeader}>
        <h4 className={styles.todoTitle}>{todo.subject}</h4>
      </div>
      
      {todo.status && (
        <p className={styles.todoStatus}>
          Status: <span className={styles.todoStatusValue}>{todo.status}</span>
        </p>
      )}
      
      {todo.etsDateTime && (
        <p className={styles.todoDate}>
          Start: {new Date(todo.etsDateTime).toLocaleString(undefined, { 
            dateStyle: 'short', 
            timeStyle: 'short' 
          })}
        </p>
      )}
      {todo.etaDateTime && (
        <p className={styles.todoDate}>
          End: {new Date(todo.etaDateTime).toLocaleString(undefined, { 
            dateStyle: 'short', 
            timeStyle: 'short' 
          })}
        </p>
      )}
      
      {todo.categories && todo.categories.length > 0 && (
        <div className={styles.todoCategories}>
          {todo.categories.map((cat, idx) => (
            <span
              key={idx}
              className={`${styles.badge} ${styles.badgeCategory}`}
            >
              {cat}
            </span>
          ))}
        </div>
      )}
      
      {todo.checklist && todo.checklist.length > 0 && (
        <div className={styles.todoChecklist}>
          <p className={styles.todoChecklistTitle}>Checklist:</p>
          <ul className={styles.todoChecklistItems}>
            {todo.checklist.map((item, idx) => (
              <li key={idx} className={styles.todoChecklistItem}>
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function MatrixPage() {
  const searchParams = useSearchParams();
  const bookId = searchParams.get('bookId');
  
  const { instance, accounts, inProgress } = useMsal();
  const [todoItems, setTodoItems] = useState<(TodoItem & { id?: string })[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draggedItem, setDraggedItem] = useState<(TodoItem & { id?: string }) | null>(null);

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

      // Fetch events from last 30 days to next 30 days
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const startDate = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      const endDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
      
      const eventsData = await getCalendarEvents(
        response.accessToken,
        bookId,
        startDate.toISOString(),
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

  const handleDragStart = (todo: TodoItem & { id?: string }) => {
    setDraggedItem(todo);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (urgent: boolean, important: boolean) => {
    if (!draggedItem || !draggedItem.id || !bookId) return;

    // Don't update if already in correct quadrant
    if (draggedItem.urgent === urgent && draggedItem.important === important) {
      setDraggedItem(null);
      return;
    }

    try {
      const account = accounts[0];
      const response = await instance.acquireTokenSilent({
        ...loginRequest,
        account: account,
      });

      await updateTodoItem(response.accessToken, bookId, draggedItem.id, {
        urgent,
        important,
      });

      // Refresh the events list after updating
      await fetchEvents();
    } catch (error: any) {
      console.error('Error updating TODO item:', error);
      setError(error.message || 'Failed to update TODO item');
    } finally {
      setDraggedItem(null);
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
      <div className={styles.container}>
        <div className={styles.inner}>
          <div className={styles.warning}>
            No calendar selected. Please select a calendar from the <a href="/books" className={styles.warningLink}>Books page</a>.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.inner}>
        <div className={styles.card}>
          <div className={styles.header}>
            <div className={styles.headerInfo}>
              <h1 className={styles.title}>Matrix View</h1>
              <p className={styles.subtitle}>Calendar: {bookId}</p>
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
                  <AddTodoItem onAddTodo={handleAddTodo} disabled={loading} />
                  <button
                    onClick={fetchEvents}
                    disabled={loading}
                    className={`${styles.button} ${styles.buttonSecondary}`}
                  >
                    {loading ? 'Loading...' : 'Refresh'}
                  </button>
                </>
              )}
            </div>
          </div>

          {error && (
            <div className={styles.error} role="alert">
              <span className={styles.errorTitle}>Error: </span>
              <span>{error}</span>
            </div>
          )}

          {loading && (
            <div className={styles.loading}>
              <div className={styles.spinner}></div>
            </div>
          )}

          {!loading && isAuthenticated && todoItems.length === 0 && (
            <div className={styles.empty}>
              No TODO items found. Click "Add TODO" to create one.
            </div>
          )}

          {!loading && isAuthenticated && todoItems.length > 0 && (
            <div className={styles.matrixSection}>
              <h2 className={styles.sectionTitle}>Eisenhower Matrix ({todoItems.length} items)</h2>
              <div className={styles.matrix}>
                {/* Top-left: Urgent & Important */}
                <div 
                  className={`${styles.quadrant} ${styles.quadrantUrgentImportant} ${draggedItem ? styles.quadrantDropZone : ''}`}
                  onDragOver={handleDragOver}
                  onDrop={() => handleDrop(true, true)}
                >
                  <div className={styles.quadrantHeader}>
                    <div>
                      <h3 className={styles.quadrantTitle}>Do First</h3>
                      <p className={styles.quadrantSubtitle}>Urgent & Important</p>
                    </div>
                    <AddTodoItem 
                      onAddTodo={handleAddTodo} 
                      disabled={loading}
                      defaultUrgent={true}
                      defaultImportant={true}
                      compact={true}
                    />
                  </div>
                  <div className={styles.quadrantContent}>
                    {todoItems
                      .filter(todo => todo.urgent === true && todo.important === true)
                      .map((todo) => (
                        <TodoCard key={todo.id} todo={todo} onDragStart={handleDragStart} />
                      ))}
                    {todoItems.filter(todo => todo.urgent === true && todo.important === true).length === 0 && (
                      <p className={styles.quadrantEmpty}>No items</p>
                    )}
                  </div>
                </div>

                {/* Top-right: Important but not Urgent */}
                <div 
                  className={`${styles.quadrant} ${styles.quadrantImportant} ${draggedItem ? styles.quadrantDropZone : ''}`}
                  onDragOver={handleDragOver}
                  onDrop={() => handleDrop(false, true)}
                >
                  <div className={styles.quadrantHeader}>
                    <div>
                      <h3 className={styles.quadrantTitle}>Schedule</h3>
                      <p className={styles.quadrantSubtitle}>Important, Not Urgent</p>
                    </div>
                    <AddTodoItem 
                      onAddTodo={handleAddTodo} 
                      disabled={loading}
                      defaultUrgent={false}
                      defaultImportant={true}
                      compact={true}
                    />
                  </div>
                  <div className={styles.quadrantContent}>
                    {todoItems
                      .filter(todo => todo.urgent !== true && todo.important === true)
                      .map((todo) => (
                        <TodoCard key={todo.id} todo={todo} onDragStart={handleDragStart} />
                      ))}
                    {todoItems.filter(todo => todo.urgent !== true && todo.important === true).length === 0 && (
                      <p className={styles.quadrantEmpty}>No items</p>
                    )}
                  </div>
                </div>

                {/* Bottom-left: Urgent but not Important */}
                <div 
                  className={`${styles.quadrant} ${styles.quadrantUrgent} ${draggedItem ? styles.quadrantDropZone : ''}`}
                  onDragOver={handleDragOver}
                  onDrop={() => handleDrop(true, false)}
                >
                  <div className={styles.quadrantHeader}>
                    <div>
                      <h3 className={styles.quadrantTitle}>Delegate</h3>
                      <p className={styles.quadrantSubtitle}>Urgent, Not Important</p>
                    </div>
                    <AddTodoItem 
                      onAddTodo={handleAddTodo} 
                      disabled={loading}
                      defaultUrgent={true}
                      defaultImportant={false}
                      compact={true}
                    />
                  </div>
                  <div className={styles.quadrantContent}>
                    {todoItems
                      .filter(todo => todo.urgent === true && todo.important !== true)
                      .map((todo) => (
                        <TodoCard key={todo.id} todo={todo} onDragStart={handleDragStart} />
                      ))}
                    {todoItems.filter(todo => todo.urgent === true && todo.important !== true).length === 0 && (
                      <p className={styles.quadrantEmpty}>No items</p>
                    )}
                  </div>
                </div>

                {/* Bottom-right: Neither Urgent nor Important */}
                <div 
                  className={`${styles.quadrant} ${styles.quadrantNeither} ${draggedItem ? styles.quadrantDropZone : ''}`}
                  onDragOver={handleDragOver}
                  onDrop={() => handleDrop(false, false)}
                >
                  <div className={styles.quadrantHeader}>
                    <div>
                      <h3 className={styles.quadrantTitle}>Eliminate</h3>
                      <p className={styles.quadrantSubtitle}>Not Urgent, Not Important</p>
                    </div>
                    <AddTodoItem 
                      onAddTodo={handleAddTodo} 
                      disabled={loading}
                      defaultUrgent={false}
                      defaultImportant={false}
                      compact={true}
                    />
                  </div>
                  <div className={styles.quadrantContent}>
                    {todoItems
                      .filter(todo => todo.urgent !== true && todo.important !== true)
                      .map((todo) => (
                        <TodoCard key={todo.id} todo={todo} onDragStart={handleDragStart} />
                      ))}
                    {todoItems.filter(todo => !todo.urgent && !todo.important).length === 0 && (
                      <p className={styles.quadrantEmpty}>No items</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
