'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '@/lib/msalConfig';
import { getCalendars, getCalendarEvents, Calendar } from '@/lib/graphService';
import { createTodoItem, updateTodoItem, sweepStaleTodos, TodoItem, parseTodoData, TodoStatus, ALL_STATUSES, STATUS_LABELS } from '@/lib/todoDataService';
import { filterArrangeCalendars, getCalendarDisplayName } from '@/lib/calendarUtils';
import { getLastBookId, setLastBookId, clearLastBookId, hasSessionSweepRun, isSessionSweepInProgress, markSessionSweepInProgress, clearSessionSweepInProgress, markSessionSweepDone } from '@/lib/bookStorage';
import AddTodoItem from '@/components/AddTodoItem';
import ViewTodoItem from '@/components/ViewTodoItem';
import ManageTags from '@/components/ManageTags';
import Link from 'next/link';
import styles from './page.module.css';

type StatusFilterMode = 'showAll' | 'todayOnly' | 'hide';

const FILTER_MODE_LABELS: Record<StatusFilterMode, string> = {
  showAll: 'All',
  todayOnly: 'Today',
  hide: 'Hide',
};

const DEFAULT_STATUS_FILTERS: Record<TodoStatus, StatusFilterMode> = {
  new: 'showAll',
  inProgress: 'showAll',
  blocked: 'showAll',
  finished: 'todayOnly',
  cancelled: 'hide',
};

const FILTER_MODES: StatusFilterMode[] = ['showAll', 'todayOnly', 'hide'];

function isToday(dateStr: string | undefined | null): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate();
}

function passesTodayFilter(todo: TodoItem): boolean {
  const status = todo.status || 'new';
  if (status === 'finished') return isToday(todo.finishDateTime);
  return isToday(todo.etsDateTime);
}

// TodoCard component for rendering individual todo items
function TodoCard({ todo, onDragStart, onClick, onStatusChange }: { 
  todo: TodoItem & { id?: string }, 
  onDragStart?: (todo: TodoItem & { id?: string }) => void,
  onClick?: (todo: TodoItem & { id?: string }) => void,
  onStatusChange?: (todo: TodoItem & { id?: string }, newStatus: TodoStatus) => void 
}) {
  const currentStatus = todo.status || 'new';

  const handleStatusClick = (e: React.MouseEvent<HTMLButtonElement>, status: TodoStatus) => {
    e.stopPropagation(); // Prevent card click when clicking status
    if (status !== currentStatus && onStatusChange) {
      onStatusChange(todo, status);
    }
  };

  return (
    <div 
      className={styles.todoCard}
      draggable={!!todo.id}
      onDragStart={() => onDragStart?.(todo)}
      onClick={() => onClick?.(todo)}
      style={{ cursor: 'pointer' }}
    >
      <div className={styles.todoHeader}>
        <h4 className={styles.todoTitle}>{todo.subject}</h4>
      </div>
      
      <div className={styles.statusContainer}>
        {ALL_STATUSES.map((status) => (
          <button
            key={status}
            className={`${styles.statusBadge} ${styles[`status_${status}`]} ${status === currentStatus ? styles.statusActive : ''}`}
            onClick={(e) => handleStatusClick(e, status)}
            title={`Set status to ${STATUS_LABELS[status]}`}
            aria-pressed={status === currentStatus}
          >
            {STATUS_LABELS[status]}
          </button>
        ))}
      </div>
      
      {/* Dates section - compact layout */}
      {(todo.etsDateTime || todo.etaDateTime || todo.startDateTime || todo.finishDateTime) && (
        <div className={styles.todoDates}>
          {/* Planned times */}
          {(todo.etsDateTime || todo.etaDateTime) && (
            <div className={styles.todoDateRow}>
              <span className={styles.todoDateLabel}>Planned:</span>
              {todo.etsDateTime && (
                <span 
                  className={styles.todoDateValue}
                  title={`ETS: ${new Date(todo.etsDateTime).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}`}
                >
                  {new Date(todo.etsDateTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
              )}
              {todo.etsDateTime && todo.etaDateTime && <span className={styles.todoDateSep}>→</span>}
              {todo.etaDateTime && (
                <span 
                  className={styles.todoDateValue}
                  title={`ETA: ${new Date(todo.etaDateTime).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}`}
                >
                  {new Date(todo.etaDateTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
              )}
            </div>
          )}
          {/* Actual times */}
          {(todo.startDateTime || todo.finishDateTime) && (
            <div className={styles.todoDateRow}>
              <span className={styles.todoDateLabel}>Actual:</span>
              {todo.startDateTime && (
                <span 
                  className={styles.todoDateValue}
                  title={`Started: ${new Date(todo.startDateTime).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}`}
                >
                  {new Date(todo.startDateTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
              )}
              {todo.startDateTime && todo.finishDateTime && <span className={styles.todoDateSep}>→</span>}
              {todo.finishDateTime && (
                <span 
                  className={styles.todoDateValue}
                  title={`Finished: ${new Date(todo.finishDateTime).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}`}
                >
                  {new Date(todo.finishDateTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
              )}
            </div>
          )}
        </div>
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
      
      {todo.checklist && todo.checklist.length > 0 && (() => {
        const done = todo.checklist.filter(i => i.startsWith('-[x]')).length;
        const total = todo.checklist.length;
        return (
          <p className={styles.todoChecklistSummary}>
            ☑ {done}/{total} completed
          </p>
        );
      })()}
    </div>
  );
}

export default function MatrixPage() {
  return (
    <Suspense fallback={
      <div className={styles.container}>
        <div className={styles.inner}>
          <div className={styles.loading}>
            <div className={styles.spinner}></div>
          </div>
        </div>
      </div>
    }>
      <MatrixPageContent />
    </Suspense>
  );
}

function MatrixPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const bookId = searchParams.get('bookId');
  const bookIdRef = useRef(bookId);
  const sweepAttemptedRef = useRef(false);
  bookIdRef.current = bookId;

  useEffect(() => {
    if (!bookId) {
      const saved = getLastBookId();
      if (saved) {
        router.replace(`/matrix?bookId=${encodeURIComponent(saved)}`);
      }
    }
  }, [bookId, router]);
  
  const { instance, accounts, inProgress } = useMsal();
  const [todoItems, setTodoItems] = useState<(TodoItem & { id?: string })[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draggedItem, setDraggedItem] = useState<(TodoItem & { id?: string }) | null>(null);
  const [selectedTodo, setSelectedTodo] = useState<(TodoItem & { id?: string }) | null>(null);
  const [statusFilters, setStatusFilters] = useState<Record<TodoStatus, StatusFilterMode>>(DEFAULT_STATUS_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [showTags, setShowTags] = useState(true);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [showUncategorized, setShowUncategorized] = useState(false);
  const [showManageTags, setShowManageTags] = useState(false);

  const isAuthenticated = accounts.length > 0;

  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const todo of todoItems) {
      if (todo.categories) {
        for (const c of todo.categories) cats.add(c);
      }
    }
    return Array.from(cats).sort((a, b) => a.localeCompare(b));
  }, [todoItems]);

  const categoryFilterActive = selectedCategories.size > 0 || showUncategorized;

  const filteredTodoItems = todoItems.filter(todo => {
    const status = todo.status || 'new';
    const mode = statusFilters[status];
    if (mode === 'hide') return false;
    if (mode === 'todayOnly' && !passesTodayFilter(todo)) return false;

    if (categoryFilterActive) {
      const hasCats = todo.categories && todo.categories.length > 0;
      if (showUncategorized && !hasCats) return true;
      if (hasCats && todo.categories!.some(c => selectedCategories.has(c))) return true;
      return false;
    }

    return true;
  });

  const quadrants = useMemo(() => ({
    doFirst: filteredTodoItems.filter(todo => todo.urgent === true && todo.important === true),
    schedule: filteredTodoItems.filter(todo => todo.urgent !== true && todo.important === true),
    delegate: filteredTodoItems.filter(todo => todo.urgent === true && todo.important !== true),
    eliminate: filteredTodoItems.filter(todo => todo.urgent !== true && todo.important !== true),
  }), [filteredTodoItems]);

  const currentCalendar = calendars.find(c => c.id === bookId);
  const currentCalendarName = currentCalendar ? getCalendarDisplayName(currentCalendar) : bookId;

  const fetchCalendars = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const account = accounts[0];
      let accessToken: string;
      try {
        const response = await instance.acquireTokenSilent({ ...loginRequest, account });
        accessToken = response.accessToken;
      } catch (silentError: any) {
        if (silentError.name === 'InteractionRequiredAuthError') {
          const response = await instance.acquireTokenPopup(loginRequest);
          accessToken = response.accessToken;
        } else {
          throw silentError;
        }
      }
      const all = await getCalendars(accessToken);
      const arrangeCalendars = filterArrangeCalendars(all);
      setCalendars(arrangeCalendars);

      if (bookId && !arrangeCalendars.some(c => c.id === bookId)) {
        clearLastBookId();
        router.replace('/books');
      } else if (bookId && arrangeCalendars.some(c => c.id === bookId)) {
        setLastBookId(bookId);
      }
    } catch (error: any) {
      console.error('Error fetching calendars:', error);
      setError(error.message || 'Failed to fetch calendars');
    }
  }, [isAuthenticated, accounts, instance, bookId, router]);

  useEffect(() => {
    fetchCalendars();
  }, [fetchCalendars]);

  const handleCalendarSwitch = (calendarId: string) => {
    router.push(`/matrix?bookId=${encodeURIComponent(calendarId)}`);
  };

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

      // Sweep stale items across ALL calendars once per session (non-blocking; per-load ref prevents retries on failure)
      if (!hasSessionSweepRun() && !isSessionSweepInProgress() && !sweepAttemptedRef.current) {
        sweepAttemptedRef.current = true;
        markSessionSweepInProgress();
        const sweepAccessToken = response.accessToken;
        const sweepBookId = bookId;
        const snapshotCalendars = calendars.length > 0 ? [...calendars] : null;
        void (async () => {
          try {
            const sweepCalendars = snapshotCalendars
              ?? filterArrangeCalendars(await getCalendars(sweepAccessToken));
            const calendarQueue = sweepCalendars.filter(c => c.id);
            const CONCURRENCY = 5;
            let i = 0;
            let hasFailure = false;
            const processNext = async () => {
              while (i < calendarQueue.length) {
                const cal = calendarQueue[i++];
                try {
                  const calEvents = await getCalendarEvents(
                    sweepAccessToken, cal.id!,
                    startDate.toISOString(), endDate.toISOString()
                  );
                  const calTodos = calEvents.map(event => parseTodoData(event));
                  await sweepStaleTodos(sweepAccessToken, cal.id!, calTodos);
                } catch (calError) {
                  hasFailure = true;
                  console.error(`Error sweeping calendar ${cal.id}:`, calError);
                }
              }
            };
            await Promise.all(Array.from({ length: CONCURRENCY }, () => processNext()));

            if (!hasFailure) {
              markSessionSweepDone();
            }
            clearSessionSweepInProgress();

            // Refresh current view if still on the same book (independent of sweep status)
            try {
              if (bookIdRef.current === sweepBookId) {
                const refreshedEvents = await getCalendarEvents(
                  sweepAccessToken, sweepBookId,
                  startDate.toISOString(), endDate.toISOString()
                );
                if (bookIdRef.current === sweepBookId) {
                  setTodoItems(refreshedEvents.map(event => parseTodoData(event)));
                }
              }
            } catch (refreshError) {
              console.error('Error refreshing view after sweep:', refreshError);
            }
          } catch (sweepError) {
            clearSessionSweepInProgress();
            console.error('Error during session sweep:', sweepError);
          }
        })();
      }
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

      const createdEvent = await createTodoItem(response.accessToken, bookId, todoItem);
      const newTodo = parseTodoData(createdEvent);
      setTodoItems(prev => [...prev, newTodo]);
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

    // Optimistic update - update UI immediately
    const previousItems = [...todoItems];
    setTodoItems(items => 
      items.map(item => 
        item.id === draggedItem.id 
          ? { ...item, urgent, important }
          : item
      )
    );
    setDraggedItem(null);

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
    } catch (error: any) {
      console.error('Error updating TODO item:', error);
      // Revert on error
      setTodoItems(previousItems);
      setError(error.message || 'Failed to update TODO item');
    }
  };

  const handleStatusChange = async (todo: TodoItem & { id?: string }, newStatus: TodoStatus) => {
    if (!todo.id || !bookId) return;

    const currentStatus = todo.status || 'new';
    const now = new Date().toISOString();

    // Calculate timestamp changes based on status transition
    let updatedTimestamps: Partial<TodoItem> = {};
    
    // Set startDateTime when status changes to inProgress (if not already set)
    if (newStatus === 'inProgress' && !todo.startDateTime) {
      updatedTimestamps.startDateTime = now;
    }
    
    // Remove startDateTime when status changes to new
    if (newStatus === 'new') {
      updatedTimestamps.startDateTime = undefined;
    }
    
    // Set timestamps when status changes to finished
    if (newStatus === 'finished') {
      // Set startDateTime if not already set (direct new → finished)
      if (!todo.startDateTime) {
        updatedTimestamps.startDateTime = now;
      }
      // Set finishDateTime if not already set
      if (!todo.finishDateTime) {
        updatedTimestamps.finishDateTime = now;
      }
    }
    
    // Remove finishDateTime when status changes from finished to anything else
    if (newStatus !== 'finished' && currentStatus === 'finished') {
      updatedTimestamps.finishDateTime = undefined;
    }

    // Optimistic update - update UI immediately
    const previousItems = [...todoItems];
    setTodoItems(items =>
      items.map(item =>
        item.id === todo.id
          ? { ...item, status: newStatus, ...updatedTimestamps }
          : item
      )
    );

    try {
      const account = accounts[0];
      const response = await instance.acquireTokenSilent({
        ...loginRequest,
        account: account,
      });

      await updateTodoItem(response.accessToken, bookId, todo.id, {
        status: newStatus,
      });
    } catch (error: any) {
      console.error('Error updating TODO status:', error);
      // Revert on error
      setTodoItems(previousItems);
      setError(error.message || 'Failed to update status');
    }
  };

  const handleUpdateTodo = async (updatedFields: Partial<TodoItem>) => {
    if (!selectedTodo?.id || !bookId) return;

    const previousItems = [...todoItems];
    setTodoItems(items =>
      items.map(item =>
        item.id === selectedTodo.id ? { ...item, ...updatedFields } : item
      )
    );
    setSelectedTodo(prev => prev ? { ...prev, ...updatedFields } : prev);

    try {
      const account = accounts[0];
      const response = await instance.acquireTokenSilent({
        ...loginRequest,
        account: account,
      });

      await updateTodoItem(response.accessToken, bookId, selectedTodo.id, updatedFields);
    } catch (error: any) {
      console.error('Error updating TODO:', error);
      setTodoItems(previousItems);
      const reverted = previousItems.find(i => i.id === selectedTodo.id);
      if (reverted) setSelectedTodo(reverted);
      throw error;
    }
  };

  const handleDeleteTag = async (tag: string) => {
    if (!bookId) return;

    const affectedItems = todoItems.filter(item => item.categories?.includes(tag));
    if (affectedItems.length === 0) return;

    const previousItems = [...todoItems];
    setTodoItems(items =>
      items.map(item =>
        item.categories?.includes(tag)
          ? { ...item, categories: item.categories.filter(c => c !== tag) }
          : item
      )
    );
    // Clean up filter state
    setSelectedCategories(prev => {
      const next = new Set(prev);
      next.delete(tag);
      return next;
    });

    try {
      const account = accounts[0];
      const response = await instance.acquireTokenSilent({ ...loginRequest, account });
      const CONCURRENCY = 5;
      let idx = 0;
      const worker = async () => {
        while (idx < affectedItems.length) {
          const item = affectedItems[idx++];
          if (!item.id) continue;
          await updateTodoItem(response.accessToken, bookId, item.id, {
            categories: (item.categories || []).filter(c => c !== tag),
          });
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, affectedItems.length) }, () => worker()));
    } catch (error: any) {
      console.error('Error deleting tag:', error);
      setTodoItems(previousItems);
      throw error;
    }
  };

  const handleRenameTag = async (oldTag: string, newTag: string) => {
    if (!bookId) return;

    const affectedItems = todoItems.filter(item => item.categories?.includes(oldTag));
    if (affectedItems.length === 0) return;

    const previousItems = [...todoItems];
    setTodoItems(items =>
      items.map(item =>
        item.categories?.includes(oldTag)
          ? { ...item, categories: item.categories.map(c => c === oldTag ? newTag : c) }
          : item
      )
    );
    // Update filter state
    setSelectedCategories(prev => {
      if (!prev.has(oldTag)) return prev;
      const next = new Set(prev);
      next.delete(oldTag);
      next.add(newTag);
      return next;
    });

    try {
      const account = accounts[0];
      const response = await instance.acquireTokenSilent({ ...loginRequest, account });
      const CONCURRENCY = 5;
      let idx = 0;
      const worker = async () => {
        while (idx < affectedItems.length) {
          const item = affectedItems[idx++];
          if (!item.id) continue;
          await updateTodoItem(response.accessToken, bookId, item.id, {
            categories: (item.categories || []).map(c => c === oldTag ? newTag : c),
          });
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, affectedItems.length) }, () => worker()));
    } catch (error: any) {
      console.error('Error renaming tag:', error);
      setTodoItems(previousItems);
      throw error;
    }
  };

  const handleMergeTag = async (sourceTag: string, targetTag: string) => {
    if (!bookId) return;

    const affectedItems = todoItems.filter(item => item.categories?.includes(sourceTag));
    if (affectedItems.length === 0) return;

    const previousItems = [...todoItems];
    setTodoItems(items =>
      items.map(item => {
        if (!item.categories?.includes(sourceTag)) return item;
        const withoutSource = item.categories.filter(c => c !== sourceTag);
        const merged = withoutSource.includes(targetTag) ? withoutSource : [...withoutSource, targetTag];
        return { ...item, categories: merged };
      })
    );
    // Update filter state: remove source, keep target
    setSelectedCategories(prev => {
      if (!prev.has(sourceTag)) return prev;
      const next = new Set(prev);
      next.delete(sourceTag);
      next.add(targetTag);
      return next;
    });

    try {
      const account = accounts[0];
      const response = await instance.acquireTokenSilent({ ...loginRequest, account });
      const CONCURRENCY = 5;
      let idx = 0;
      const worker = async () => {
        while (idx < affectedItems.length) {
          const item = affectedItems[idx++];
          if (!item.id) continue;
          const cats = item.categories || [];
          const withoutSource = cats.filter(c => c !== sourceTag);
          const merged = withoutSource.includes(targetTag) ? withoutSource : [...withoutSource, targetTag];
          await updateTodoItem(response.accessToken, bookId, item.id, { categories: merged });
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, affectedItems.length) }, () => worker()));
    } catch (error: any) {
      console.error('Error merging tags:', error);
      setTodoItems(previousItems);
      throw error;
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
            No book selected. Please select a book from the <Link href="/books" className={styles.warningLink}>Books page</Link>.
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
              {calendars.length > 1 ? (
                <select
                  className={styles.bookSwitcher}
                  value={bookId || ''}
                  onChange={(e) => handleCalendarSwitch(e.target.value)}
                >
                  {calendars.map(cal => (
                    <option key={cal.id} value={cal.id}>
                      {getCalendarDisplayName(cal)}
                    </option>
                  ))}
                </select>
              ) : (
                <p className={styles.subtitle}>{currentCalendarName}</p>
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
                  <AddTodoItem onAddTodo={handleAddTodo} disabled={loading} availableCategories={allCategories} />
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

          {!loading && isAuthenticated && (
            <div className={styles.matrixSection}>
              <div className={styles.matrixHeader}>
                <span className={styles.filterCount}>Showing {filteredTodoItems.length} of {todoItems.length} items</span>
                <div className={styles.matrixHeaderActions}>
                  {allCategories.length > 0 && (
                    <>
                      <button
                        className={`${styles.button} ${styles.buttonSecondary} ${styles.filterToggle}`}
                        onClick={() => setShowTags(prev => !prev)}
                      >
                        {showTags ? '▲' : '▼'} Tags{categoryFilterActive ? ' ●' : ''}
                      </button>
                      <button
                        className={`${styles.button} ${styles.buttonSecondary} ${styles.filterToggle}`}
                        onClick={() => setShowManageTags(true)}
                        title="Manage tags"
                      >
                        ⚙
                      </button>
                    </>
                  )}
                  <button
                    className={`${styles.button} ${styles.buttonSecondary} ${styles.filterToggle}`}
                    onClick={() => setShowFilters(prev => !prev)}
                  >
                    {showFilters ? '▲ Status' : '▼ Status'}
                  </button>
                </div>
              </div>
              {showFilters && (
                <div className={styles.filterBar}>
                  {ALL_STATUSES.map(status => (
                    <div key={status} className={styles.filterGroup}>
                      <span className={`${styles.filterLabel} ${styles[`status_${status}`]}`}>{STATUS_LABELS[status]}</span>
                      <div className={styles.filterModes}>
                        {FILTER_MODES.map(mode => (
                          <button
                            key={mode}
                            className={`${styles.filterMode} ${statusFilters[status] === mode ? styles.filterModeActive : ''}`}
                            onClick={() => setStatusFilters(prev => ({ ...prev, [status]: mode }))}
                          >
                            {FILTER_MODE_LABELS[mode]}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {showTags && allCategories.length > 0 && (
                <div className={styles.tagBar}>
                  <div className={styles.categoryFilterChips}>
                      <button
                        className={`${styles.categoryFilterChip} ${showUncategorized ? styles.categoryFilterChipActive : ''}`}
                        onClick={() => setShowUncategorized(prev => !prev)}
                      >
                        Untagged
                      </button>
                      {allCategories.map(cat => {
                        const isSelected = selectedCategories.has(cat);
                        return (
                          <button
                            key={cat}
                            className={`${styles.categoryFilterChip} ${isSelected ? styles.categoryFilterChipActive : ''}`}
                            onClick={() => setSelectedCategories(prev => {
                              const next = new Set(prev);
                              if (isSelected) next.delete(cat); else next.add(cat);
                              return next;
                            })}
                          >
                            {cat}
                          </button>
                        );
                      })}
                      {categoryFilterActive && (
                        <button
                          className={`${styles.categoryFilterChip} ${styles.categoryFilterClear}`}
                          onClick={() => { setSelectedCategories(new Set()); setShowUncategorized(false); }}
                        >
                          ✕ Clear
                        </button>
                      )}
                    </div>
                </div>
              )}
              <div className={styles.matrix}>
                {/* Top-left: Urgent & Important */}
                <div 
                  className={`${styles.quadrant} ${styles.quadrantUrgentImportant} ${draggedItem ? styles.quadrantDropZone : ''}`}
                  onDragOver={handleDragOver}
                  onDrop={() => handleDrop(true, true)}
                >
                  <div className={styles.quadrantHeader}>
                    <div>
                      <h3 className={styles.quadrantTitle}>Do First ({quadrants.doFirst.length})</h3>
                      <p className={styles.quadrantSubtitle}>Urgent & Important</p>
                    </div>
                    <AddTodoItem 
                      onAddTodo={handleAddTodo} 
                      disabled={loading}
                      defaultUrgent={true}
                      defaultImportant={true}
                      compact={true}
                      availableCategories={allCategories}
                    />
                  </div>
                  <div className={styles.quadrantContent}>
                    {quadrants.doFirst.map((todo) => (
                        <TodoCard key={todo.id} todo={todo} onDragStart={handleDragStart} onClick={setSelectedTodo} onStatusChange={handleStatusChange} />
                      ))}
                    {quadrants.doFirst.length === 0 && (
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
                      <h3 className={styles.quadrantTitle}>Schedule ({quadrants.schedule.length})</h3>
                      <p className={styles.quadrantSubtitle}>Important, Not Urgent</p>
                    </div>
                    <AddTodoItem 
                      onAddTodo={handleAddTodo} 
                      disabled={loading}
                      defaultUrgent={false}
                      defaultImportant={true}
                      compact={true}
                      availableCategories={allCategories}
                    />
                  </div>
                  <div className={styles.quadrantContent}>
                    {quadrants.schedule.map((todo) => (
                        <TodoCard key={todo.id} todo={todo} onDragStart={handleDragStart} onClick={setSelectedTodo} onStatusChange={handleStatusChange} />
                      ))}
                    {quadrants.schedule.length === 0 && (
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
                      <h3 className={styles.quadrantTitle}>Delegate ({quadrants.delegate.length})</h3>
                      <p className={styles.quadrantSubtitle}>Urgent, Not Important</p>
                    </div>
                    <AddTodoItem 
                      onAddTodo={handleAddTodo} 
                      disabled={loading}
                      defaultUrgent={true}
                      defaultImportant={false}
                      compact={true}
                      availableCategories={allCategories}
                    />
                  </div>
                  <div className={styles.quadrantContent}>
                    {quadrants.delegate.map((todo) => (
                        <TodoCard key={todo.id} todo={todo} onDragStart={handleDragStart} onClick={setSelectedTodo} onStatusChange={handleStatusChange} />
                      ))}
                    {quadrants.delegate.length === 0 && (
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
                      <h3 className={styles.quadrantTitle}>Eliminate ({quadrants.eliminate.length})</h3>
                      <p className={styles.quadrantSubtitle}>Not Urgent, Not Important</p>
                    </div>
                    <AddTodoItem 
                      onAddTodo={handleAddTodo} 
                      disabled={loading}
                      defaultUrgent={false}
                      defaultImportant={false}
                      compact={true}
                      availableCategories={allCategories}
                    />
                  </div>
                  <div className={styles.quadrantContent}>
                    {quadrants.eliminate.map((todo) => (
                        <TodoCard key={todo.id} todo={todo} onDragStart={handleDragStart} onClick={setSelectedTodo} onStatusChange={handleStatusChange} />
                      ))}
                    {quadrants.eliminate.length === 0 && (
                      <p className={styles.quadrantEmpty}>No items</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* View Todo Dialog */}
          {selectedTodo && (
            <ViewTodoItem 
              todo={selectedTodo} 
              onClose={() => setSelectedTodo(null)}
              onUpdate={handleUpdateTodo}
              availableCategories={allCategories}
            />
          )}

          {/* Manage Tags Dialog */}
          {showManageTags && (
            <ManageTags
              tags={allCategories}
              todoItems={todoItems}
              onRenameTag={handleRenameTag}
              onDeleteTag={handleDeleteTag}
              onMergeTag={handleMergeTag}
              onClose={() => setShowManageTags(false)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
