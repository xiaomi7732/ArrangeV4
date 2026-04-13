'use client';

import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { getAllCalendarEvents } from '@/lib/graphService';
import { deleteTodoItem, TodoItem, parseTodoData } from '@/lib/todoDataService';
import { getCalendarDisplayName } from '@/lib/calendarUtils';
import { useGraphToken } from '@/lib/hooks/useGraphToken';
import { useBookId } from '@/lib/hooks/useBookId';
import { useSetTopBarActions } from '@/components/TopBarProvider';
import ViewTodoItem from '@/components/ViewTodoItem';
import Link from 'next/link';
import styles from './page.module.css';

function CancelledPageContent() {
  const { acquireToken, isAuthenticated, inProgress, handleLogin: graphLogin } = useGraphToken();
  const { bookId, calendars, currentCalendarName, handleCalendarSwitch, error: calendarError } = useBookId('/cancelled');

  const [cancelledItems, setCancelledItems] = useState<(TodoItem & { id?: string })[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({ done: 0, total: 0 });
  const [selectedTodo, setSelectedTodo] = useState<(TodoItem & { id?: string }) | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  const displayError = error || calendarError;

  const allSelected = cancelledItems.length > 0 && cancelledItems.every(t => t.id && selectedIds.has(t.id));

  const fetchEvents = useCallback(async () => {
    if (!isAuthenticated || !bookId) return;

    setLoading(true);
    setError(null);

    try {
      const accessToken = await acquireToken();
      const eventsData = await getAllCalendarEvents(accessToken, bookId);
      const todos = eventsData.map(event => parseTodoData(event));
      setCancelledItems(todos.filter(t => t.status === 'cancelled'));
      setSelectedIds(new Set());
    } catch (err: unknown) {
      console.error('Error fetching events:', err);
      const message = err instanceof Error ? err.message : 'Failed to fetch events';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, bookId, acquireToken]);

  useEffect(() => {
    if (isAuthenticated && inProgress === 'none' && bookId) {
      fetchEvents();
    }
  }, [isAuthenticated, inProgress, bookId, fetchEvents]);

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    setShowConfirm(true);
  };

  const handleLogin = async () => {
    try {
      await graphLogin();
    } catch (err) {
      console.error('Login failed:', err);
      setError('Login failed. Please try again.');
    }
  };

  useSetTopBarActions(
    calendars.length > 1 ? (
      <select
        className={styles.bookSwitcher}
        value={bookId || ''}
        onChange={(e) => handleCalendarSwitch(e.target.value)}
        disabled={loading || deleting}
      >
        {calendars.map(cal => (
          <option key={cal.id} value={cal.id}>
            {getCalendarDisplayName(cal)}
          </option>
        ))}
      </select>
    ) : null,
    !isAuthenticated ? (
      <button
        onClick={handleLogin}
        disabled={inProgress !== 'none'}
        className={`${styles.button} ${styles.buttonPrimary}`}
      >
        {inProgress !== 'none' ? 'Signing in...' : 'Sign In'}
      </button>
    ) : (
      <>
        <button
          onClick={handleDeleteSelected}
          disabled={loading || selectedIds.size === 0 || deleting}
          className={`${styles.button} ${styles.buttonDanger}`}
        >
          Delete ({selectedIds.size})
        </button>
        <button
          onClick={fetchEvents}
          disabled={loading}
          className={`${styles.button} ${styles.buttonSecondary}`}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </>
    ),
    [isAuthenticated, inProgress, loading, deleting, bookId, calendars, selectedIds.size],
  );

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(cancelledItems.filter(t => t.id).map(t => t.id!)));
    }
  };

  // Focus the confirm button when the dialog appears
  useEffect(() => {
    if (showConfirm) {
      confirmButtonRef.current?.focus();
    }
  }, [showConfirm]);

  const confirmDelete = async () => {
    if (!bookId || selectedIds.size === 0) return;

    setDeleting(true);
    const idsToDelete = Array.from(selectedIds);
    setDeleteProgress({ done: 0, total: idsToDelete.length });

    // Optimistic removal — keep a snapshot for rollback
    const previousItems = [...cancelledItems];
    setCancelledItems(items => items.filter(item => !item.id || !selectedIds.has(item.id)));

    const CONCURRENCY = 5;
    let idx = 0;
    let completed = 0;
    let hasFailure = false;

    try {
      const accessToken = await acquireToken();

      const worker = async () => {
        while (idx < idsToDelete.length) {
          const eventId = idsToDelete[idx++];
          try {
            await deleteTodoItem(accessToken, bookId, eventId);
          } catch (err) {
            hasFailure = true;
            console.error(`Error deleting event ${eventId}:`, err);
          }
          completed++;
          setDeleteProgress({ done: completed, total: idsToDelete.length });
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, idsToDelete.length) }, () => worker()),
      );

      if (hasFailure) {
        await fetchEvents();
        setError('Some items could not be deleted. The list has been refreshed.');
      } else {
        setSelectedIds(new Set());
      }
    } catch (err: unknown) {
      console.error('Error during bulk delete:', err);
      const message = err instanceof Error ? err.message : 'Failed to delete items';
      setError(message);
      setCancelledItems(previousItems);
    } finally {
      setDeleting(false);
      setShowConfirm(false);
    }
  };

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
        {displayError && (
          <div className={styles.error} role="alert">
            <span className={styles.errorTitle}>Error: </span>
            <span>{displayError}</span>
          </div>
        )}

        {loading && (
          <div className={styles.loading}>
            <div className={styles.spinner}></div>
          </div>
        )}

        {!loading && isAuthenticated && (
          <div className={styles.card}>
            {cancelledItems.length === 0 ? (
              <div className={styles.empty}>
                <p className={styles.emptyTitle}>No cancelled tasks</p>
                <p className={styles.emptyHint}>
                  Tasks you cancel in the Matrix view will appear here for review and deletion.
                </p>
              </div>
            ) : (
              <>
                <div className={styles.toolbar}>
                  <span className={styles.selectionInfo}>
                    {cancelledItems.length} cancelled {cancelledItems.length === 1 ? 'task' : 'tasks'}
                  </span>
                </div>
                <div className={styles.taskList}>
                  <div className={styles.selectAllRow}>
                    <input
                      type="checkbox"
                      className={styles.taskCheckbox}
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      aria-label="Select all cancelled tasks"
                    />
                    <span>Select all</span>
                  </div>
                  {cancelledItems.map(todo => {
                    const isSelected = !!todo.id && selectedIds.has(todo.id);
                    return (
                      <div
                        key={todo.id}
                        className={`${styles.taskRow} ${isSelected ? styles.taskRowSelected : ''}`}
                        onClick={() => setSelectedTodo(todo)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedTodo(todo); } }}
                      >
                        <input
                          type="checkbox"
                          className={styles.taskCheckbox}
                          checked={isSelected}
                          onChange={() => todo.id && toggleSelect(todo.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Select ${todo.subject}`}
                        />
                        <div className={styles.taskInfo}>
                          <div className={styles.taskSubject}>{todo.subject}</div>
                          <div className={styles.taskMeta}>
                            {todo.etsDateTime && (
                              <span>ETS: {new Date(todo.etsDateTime).toLocaleDateString()}</span>
                            )}
                            {todo.etaDateTime && (
                              <span>ETA: {new Date(todo.etaDateTime).toLocaleDateString()}</span>
                            )}
                          </div>
                        </div>
                        {todo.categories && todo.categories.length > 0 && (
                          <div className={styles.taskCategories}>
                            {todo.categories.map(cat => (
                              <span key={cat} className={styles.taskCategory}>{cat}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* Detail view dialog (read-only) */}
        {selectedTodo && (
          <ViewTodoItem
            todo={selectedTodo}
            onClose={() => setSelectedTodo(null)}
          />
        )}

        {/* Confirmation dialog */}
        {showConfirm && (
          <div className={styles.confirmOverlay} onClick={() => !deleting && setShowConfirm(false)}>
            <div
              className={styles.confirmDialog}
              role="dialog"
              aria-modal="true"
              aria-labelledby="cancelled-delete-confirm-title"
              aria-describedby="cancelled-delete-confirm-message"
              onClick={e => e.stopPropagation()}
            >
              <h2 id="cancelled-delete-confirm-title" className={styles.confirmTitle}>Delete {selectedIds.size} {selectedIds.size === 1 ? 'task' : 'tasks'}?</h2>
              <p id="cancelled-delete-confirm-message" className={styles.confirmMessage}>
                This action cannot be undone. The selected cancelled tasks will be permanently removed from your calendar.
              </p>
              {deleting && (
                <p className={styles.deletingInfo}>
                  Deleting… {deleteProgress.done} of {deleteProgress.total}
                </p>
              )}
              <div className={styles.confirmActions}>
                <button
                  onClick={() => setShowConfirm(false)}
                  disabled={deleting}
                  className={`${styles.button} ${styles.buttonSecondary}`}
                >
                  Cancel
                </button>
                <button
                  ref={confirmButtonRef}
                  onClick={confirmDelete}
                  disabled={deleting}
                  className={`${styles.button} ${styles.buttonDanger}`}
                >
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function CancelledPage() {
  return (
    <Suspense fallback={
      <div className={styles.container}>
        <div className={styles.inner}>
          <div className={styles.loading}><div className={styles.spinner}></div></div>
        </div>
      </div>
    }>
      <CancelledPageContent />
    </Suspense>
  );
}
