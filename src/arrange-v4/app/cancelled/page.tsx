'use client';

import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useStore } from '@/lib/store/useStore';
import type { StoreOperationOptions, TodoItem, TodoItemWithId } from '@/lib/store/types';
import { formatRelativeDate } from '@/lib/dateUtils';
import { retainExistingIds } from '@/lib/selectionUtils';
import { useAuthClient } from '@/lib/auth/useAuthClient';
import { isInteractiveAuthenticationRequiredError } from '@/lib/auth/errors';
import { useBookId } from '@/lib/hooks/useBookId';
import { useRefreshOnPageActivation } from '@/lib/hooks/useRefreshOnPageActivation';
import { useSetTopBarActions } from '@/components/TopBarProvider';
import AuthRecoveryPanel from '@/components/AuthRecoveryPanel';
import ViewTodoItem from '@/components/ViewTodoItem';
import Link from 'next/link';
import styles from './page.module.css';

type FetchEventsOptions = StoreOperationOptions & {
  preserveError?: boolean;
  preserveSelection?: boolean;
};

function CancelledPageContent() {
  const auth = useAuthClient();
  const { isAuthenticated, busy } = auth;
  const store = useStore();
  const {
    bookId,
    books,
    handleBookSwitch,
    fetchBooks,
    authRecoveryRequired: bookAuthRecoveryRequired,
    error: bookError,
  } = useBookId('/cancelled');

  const [cancelledItems, setCancelledItems] = useState<TodoItemWithId[]>([]);
  const [itemsBookId, setItemsBookId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authRecoveryRequired, setAuthRecoveryRequired] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({ done: 0, total: 0 });
  const [selectedTodo, setSelectedTodo] = useState<(TodoItem & { id?: string }) | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const bookIdRef = useRef(bookId);
  const fetchSequenceRef = useRef(0);

  bookIdRef.current = bookId;

  const displayError = error || bookError;
  const requiresAuthRecovery = authRecoveryRequired || bookAuthRecoveryRequired;

  const allSelected = cancelledItems.length > 0 && cancelledItems.every(t => selectedIds.has(t.id));

  const fetchEvents = useCallback(async ({
    preserveError = false,
    preserveSelection = false,
    interaction = 'allow-interactive',
  }: FetchEventsOptions = {}) => {
    const requestedBookId = bookIdRef.current;
    if (!isAuthenticated || !requestedBookId) return;
    const fetchSequence = ++fetchSequenceRef.current;

    setLoading(true);
    if (!preserveError) setError(null);

    try {
      const items = await store.listItems(requestedBookId, {
        range: 'all',
        interaction,
      });
      if (
        fetchSequenceRef.current !== fetchSequence ||
        bookIdRef.current !== requestedBookId
      ) return;
      const nextItems = items.filter(t => t.status === 'cancelled');
      setCancelledItems(nextItems);
      setItemsBookId(requestedBookId);
      setAuthRecoveryRequired(false);
      setSelectedIds(previous => preserveSelection
        ? retainExistingIds(previous, nextItems.map(item => item.id))
        : new Set<string>());
    } catch (err: unknown) {
      if (
        fetchSequenceRef.current !== fetchSequence ||
        bookIdRef.current !== requestedBookId
      ) return;
      if (
        interaction === 'silent-only' &&
        isInteractiveAuthenticationRequiredError(err)
      ) {
        setAuthRecoveryRequired(true);
        setShowConfirm(false);
        setError(null);
        return;
      }
      console.error('Error fetching events:', err);
      const message = err instanceof Error ? err.message : 'Failed to fetch events';
      setError(message);
    } finally {
      if (
        fetchSequenceRef.current === fetchSequence &&
        bookIdRef.current === requestedBookId
      ) {
        setLoading(false);
      }
    }
  }, [isAuthenticated, store]);

  useEffect(() => {
    if (bookId && bookId !== itemsBookId) {
      setLoading(isAuthenticated && !busy);
      setCancelledItems([]);
      setSelectedIds(new Set());
      setSelectedTodo(null);
      setShowConfirm(false);
    }
  }, [bookId, itemsBookId, isAuthenticated, busy]);

  useEffect(() => {
    if (isAuthenticated && !busy && bookId) {
      fetchEvents({ interaction: 'silent-only' });
    }
  }, [isAuthenticated, busy, bookId, fetchEvents]);

  useRefreshOnPageActivation(
    () => void fetchEvents({
      preserveError: true,
      preserveSelection: true,
      interaction: 'silent-only',
    }),
    isAuthenticated &&
      !requiresAuthRecovery &&
      !busy &&
      !!bookId &&
      !loading &&
      !deleting &&
      !showConfirm,
  );

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    setShowConfirm(true);
  };

  const handleLogin = async () => {
    setError(null);
    try {
      await auth.login();
    } catch (err) {
      console.error('Login failed:', err);
      setError('Login failed. Please try again.');
    }
  };

  const handleAuthRecovery = async () => {
    if (isAuthenticated) {
      let booksRecovered = true;
      if (bookAuthRecoveryRequired) {
        booksRecovered = await fetchBooks({ interaction: 'allow-interactive' });
      }
      if (booksRecovered && authRecoveryRequired) {
        await fetchEvents();
      }
      return;
    }
    await handleLogin();
  };

  useSetTopBarActions(
    isAuthenticated && !requiresAuthRecovery && books.length > 1 ? (
      <select
        className={styles.bookSwitcher}
        value={bookId || ''}
        onChange={(e) => handleBookSwitch(e.target.value)}
        disabled={loading || deleting}
      >
        {books.map(b => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    ) : null,
    !isAuthenticated ? (
      <button
        onClick={handleLogin}
        disabled={busy}
        className={`${styles.button} ${styles.buttonPrimary}`}
      >
        {busy ? 'Signing in...' : 'Sign In'}
      </button>
    ) : requiresAuthRecovery ? null : (
      <>
        <button
          onClick={handleDeleteSelected}
          disabled={loading || selectedIds.size === 0 || deleting}
          className={`${styles.button} ${styles.buttonDanger}`}
        >
          Delete ({selectedIds.size})
        </button>
        <button
          onClick={() => void fetchEvents()}
          disabled={loading}
          className={`${styles.button} ${styles.buttonSecondary}`}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </>
    ),
    [
      isAuthenticated,
      requiresAuthRecovery,
      busy,
      loading,
      deleting,
      bookId,
      books,
      selectedIds.size,
    ],
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
      setSelectedIds(new Set(cancelledItems.map(t => t.id)));
    }
  };

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

    const previousItems = [...cancelledItems];
    setCancelledItems(items => items.filter(item => !selectedIds.has(item.id)));

    const CONCURRENCY = 5;
    let idx = 0;
    let completed = 0;
    let hasFailure = false;

    try {
      const worker = async () => {
        while (idx < idsToDelete.length) {
          const eventId = idsToDelete[idx++];
          try {
            await store.deleteItem(bookId, eventId);
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

  if (!bookId && isAuthenticated && !requiresAuthRecovery) {
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

  if (!isAuthenticated || requiresAuthRecovery) {
    return (
      <div className={styles.container}>
        <div className={styles.inner}>
          <AuthRecoveryPanel
            busy={busy || (requiresAuthRecovery && loading)}
            error={displayError}
            onLogin={handleAuthRecovery}
          />
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

        {!loading && (
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
                            {todo.etaDateTime && (() => {
                              const eta = formatRelativeDate(todo.etaDateTime);
                              return (
                                <span
                                  title={`ETA: ${eta.fullDate}`}
                                  style={eta.isOverdue ? { color: '#dc2626', fontWeight: 600 } : undefined}
                                >
                                  ETA: {eta.text}
                                </span>
                              );
                            })()}
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
