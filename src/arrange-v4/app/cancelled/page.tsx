'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { useStore } from '@/lib/store/useStore';
import type { StoreOperationOptions, TodoItem, TodoItemWithId } from '@/lib/store/types';
import { formatRelativeDate } from '@/lib/dateUtils';
import { retainExistingIds } from '@/lib/selectionUtils';
import { filterTasks, SHOW_ALL_STATUS_FILTERS } from '@/lib/search/taskQuery';
import { composeReconcileFailure } from '@/lib/reconcileMessage';
import { useTaskQuery } from '@/lib/search/useTaskQuery';
import { useAuthClient } from '@/lib/auth/useAuthClient';
import { isInteractiveAuthenticationRequiredError } from '@/lib/auth/errors';
import { useBookId } from '@/lib/hooks/useBookId';
import { useRefreshOnPageActivation } from '@/lib/hooks/useRefreshOnPageActivation';
import { useSetTopBarActions } from '@/components/TopBarProvider';
import AuthRecoveryPanel from '@/components/AuthRecoveryPanel';
import ErrorBanner from '@/components/ErrorBanner';
import ViewTodoItem from '@/components/ViewTodoItem';
import TaskSearchBar from '@/components/TaskSearchBar';
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
    setError: setBookError,
  } = useBookId('/cancelled');

  const [cancelledItems, setCancelledItems] = useState<TodoItemWithId[]>([]);
  const [itemsBookId, setItemsBookId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when a delete failed and its rows were put back: the list is then a
  // guess until a fetch succeeds, because a rejected bulk delete may still
  // have removed some of them.
  const unverifiedWriteRef = useRef<{ bookId: string; message: string } | null>(null);
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

  // Every item on this page is already cancelled, so the shared status filters
  // (which hide cancelled items by default) must not be applied here. This view
  // also offers search only, so it keeps its own preset scope: board presets
  // carry tag/priority/status criteria it cannot display or edit.
  const taskQuery = useTaskQuery(bookId, {
    defaultStatusFilters: SHOW_ALL_STATUS_FILTERS,
    presetScope: 'cancelled',
  });
  const { query } = taskQuery;

  const visibleItems = useMemo(
    () => filterTasks(cancelledItems, query, { applyStatusFilters: false }),
    [cancelledItems, query],
  );

  // Bulk delete acts only on what is on screen, so a task hidden by the current
  // search can never be removed.
  const deletableIds = useMemo(
    () => visibleItems.filter(item => selectedIds.has(item.id)).map(item => item.id),
    [visibleItems, selectedIds],
  );

  // Drop selections that the current search hides, so the checkbox state the
  // user returns to after clearing a search is not silently stale.
  useEffect(() => {
    setSelectedIds(previous => {
      if (previous.size === 0) return previous;
      const next = retainExistingIds(previous, visibleItems.map(item => item.id));
      return next.size === previous.size ? previous : next;
    });
  }, [visibleItems]);

  const allSelected = visibleItems.length > 0 && visibleItems.every(t => selectedIds.has(t.id));

  // Deletion removes items optimistically, which empties `deletableIds` while
  // the request is still running. The dialog keeps showing the count it started
  // with so it never reads "Delete 0 tasks?" mid-flight.
  const confirmCount = deleting ? deleteProgress.total : deletableIds.length;

  const fetchEvents = useCallback(async ({
    preserveError = false,
    preserveSelection = false,
    interaction = 'allow-interactive',
  }: FetchEventsOptions = {}) => {
    const requestedBookId = bookIdRef.current;
    if (!isAuthenticated || !requestedBookId) return;
    const fetchSequence = ++fetchSequenceRef.current;

    setLoading(true);
    // A write that is still unverified outlives a manual refresh: only a
    // successful read may retract it.
    // Switching book drops an unverified failure: it belongs to work the user
    // is no longer looking at, and a read of another book verifies nothing.
    const strayWrite = unverifiedWriteRef.current?.bookId === requestedBookId
      ? null
      : unverifiedWriteRef.current;
    if (strayWrite) unverifiedWriteRef.current = null;
    if (!preserveError) {
      setError(unverifiedWriteRef.current?.message ?? null);
    } else if (strayWrite) {
      // Preserved errors are the one case where the dropped failure may still
      // be on screen, and nothing left can ever retract it.
      setError(previous => (previous?.startsWith(strayWrite.message) ? null : previous));
    }

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
      if (unverifiedWriteRef.current) {
        // This read is authoritative, so the board is no longer a guess. The
        // write failure itself stays: the user still needs to know it failed.
        setError(unverifiedWriteRef.current.message);
        unverifiedWriteRef.current = null;
      }
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
      // While a rolled-back delete is still unverified, every failed refresh
      // has to keep saying so - not just the first one after the failure.
      // Always composed from the write failure, never from the banner, so a
      // run of failed refreshes replaces its clause instead of stacking.
      setError(composeReconcileFailure(unverifiedWriteRef.current?.message ?? null, message, 'list'));
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
    if (deletableIds.length === 0) return;
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
          disabled={loading || deletableIds.length === 0 || deleting}
          className={`${styles.button} ${styles.buttonDanger}`}
        >
          Delete ({deletableIds.length})
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
      deletableIds.length,
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
      setSelectedIds(new Set(visibleItems.map(t => t.id)));
    }
  };

  useEffect(() => {
    if (showConfirm) {
      confirmButtonRef.current?.focus();
    }
  }, [showConfirm]);

  const confirmDelete = async () => {
    if (!bookId || deletableIds.length === 0) return;

    setDeleting(true);
    const idsToDelete = [...deletableIds];
    const deleteSet = new Set(idsToDelete);
    const snapshot = cancelledItems;
    const operationBookId = bookId;
    setDeleteProgress({ done: 0, total: idsToDelete.length });

    setCancelledItems(items => items.filter(item => !deleteSet.has(item.id)));

    try {
      await store.deleteItems(bookId, idsToDelete);
      setDeleteProgress({ done: idsToDelete.length, total: idsToDelete.length });
      setSelectedIds(new Set());
    } catch (err: unknown) {
      console.error('Error during bulk delete:', err);
      // Put the rows back before reconciling: the refetch is the authoritative
      // answer, but it cannot run offline, and leaving the list empty would
      // claim a deletion that never happened.
      if (bookIdRef.current === operationBookId) setCancelledItems(snapshot);
      const message = err instanceof Error ? err.message : 'Failed to delete items';
      // Held until a read proves the list: a bulk delete can partly succeed
      // and still reject, so the restored rows are a guess until then.
      unverifiedWriteRef.current = { bookId: operationBookId, message };
      setError(message);
      // preserveError: a bulk delete can partially succeed, so the refetch is
      // what reconciles which rows really went away — but it must not overwrite
      // the reason the delete failed.
      await fetchEvents({ preserveError: true, preserveSelection: true });
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
          <ErrorBanner
            message={displayError}
            onDismiss={() => { unverifiedWriteRef.current = null; setError(null); setBookError(null); }}
          />
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
                <TaskSearchBar
                  query={query}
                  queryActive={taskQuery.queryActive}
                  resultCount={visibleItems.length}
                  totalCount={cancelledItems.length}
                  onTextChange={taskQuery.setText}
                  onClearAll={taskQuery.clearAll}
                  presets={taskQuery.presets}
                  activePresetId={taskQuery.activePresetId}
                  selectedPresetId={taskQuery.selectedPresetId}
                  presetError={taskQuery.presetError}
                  onApplyPreset={taskQuery.applyPreset}
                  onSavePreset={taskQuery.savePreset}
                  onRenamePreset={taskQuery.renamePreset}
                  onDeletePreset={taskQuery.deletePreset}
                  onDismissPresetError={taskQuery.dismissPresetError}
                  disabled={deleting}
                />
                {visibleItems.length === 0 ? (
                  <div className={styles.empty}>
                    <p className={styles.emptyTitle}>No matching cancelled tasks</p>
                    <p className={styles.emptyHint}>
                      No cancelled task matches the current search. Clear the search to see all {cancelledItems.length}.
                    </p>
                  </div>
                ) : (
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
                  {visibleItems.map(todo => {
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
                            {todo.etsDateTime && (() => {
                              const ets = formatRelativeDate(todo.etsDateTime);
                              return (
                                <span title={`ETS: ${ets.fullDate}`}>ETS: {ets.text}</span>
                              );
                            })()}
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
                )}
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
              <h2 id="cancelled-delete-confirm-title" className={styles.confirmTitle}>Delete {confirmCount} {confirmCount === 1 ? 'task' : 'tasks'}?</h2>
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
