'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback, useId, Suspense } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useStore } from '@/lib/store/useStore';
import { TodoItem, TodoItemWithId, TodoStatus, ALL_STATUSES, STATUS_LABELS } from '@/lib/store/types';
import type { AuthInteraction, StoreOperationOptions } from '@/lib/store/types';
import { formatRelativeDate } from '@/lib/dateUtils';
import { describeDateBump } from '@/lib/bumpNotice';
import {
  FILTER_MODE_LABELS,
  FILTER_MODES,
  filterTasks,
  isCategoryFilterActive,
  isStatusFilterActive,
} from '@/lib/search/taskQuery';
import { summarizeHiddenByStatus } from '@/lib/search/hiddenSummary';
import { useTaskQuery } from '@/lib/search/useTaskQuery';
import {
  keepStoredOrder,
  moveBetweenContainers,
  nextOrder,
  normalizeOrder,
  reorderVisibleItems,
  replaceItems,
  sortByPersistedOrder,
} from '@/lib/orderUtils';
import { describeSkippedUnwritable, dropUnwritableUpdates, partitionWritableItems, restoreSnapshot, snapshotItems } from '@/lib/optimisticUpdate';
import { countCheckedEntries } from '@/lib/checklist';
import { describeFailure } from '@/lib/failureMessage';
import { bannerDerivesFrom, composeReconcileFailure } from '@/lib/reconcileMessage';
import { statusTimestampUpdates } from '@/lib/statusTimestamps';
import { hasSessionSweepRun, isSessionSweepInProgress, markSessionSweepInProgress, clearSessionSweepInProgress, markSessionSweepDone } from '@/lib/bookStorage';
import { useAuthClient } from '@/lib/auth/useAuthClient';
import { isInteractiveAuthenticationRequiredError } from '@/lib/auth/errors';
import { useBookId } from '@/lib/hooks/useBookId';
import { useMoveTodo } from '@/lib/hooks/useMoveTodo';
import { useRefreshOnPageActivation } from '@/lib/hooks/useRefreshOnPageActivation';
import { useDismissiblePanel } from '@/lib/hooks/useDismissiblePanel';
import { useSetTopBarActions } from '@/components/TopBarProvider';
import AuthRecoveryPanel from '@/components/AuthRecoveryPanel';
import ErrorBanner from '@/components/ErrorBanner';
import EmptyListMessage from '@/components/EmptyListMessage';
import AddTodoItem from '@/components/AddTodoItem';
import ViewTodoItem from '@/components/ViewTodoItem';
import ManageTags from '@/components/ManageTags';
import TaskSearchBar from '@/components/TaskSearchBar';
import {
  SortableTodo,
  SortableTodoList,
  SortableTodoOverlay,
  sortableTodoCollisionDetection,
  sortableTodoKeyboardCoordinates,
} from '@/components/SortableTodo';
import Link from 'next/link';
import styles from './page.module.css';

type FetchEventsOptions = StoreOperationOptions & {
  preserveError?: boolean;
};

type QuadrantKey = 'doFirst' | 'schedule' | 'delegate' | 'eliminate';

type QuadrantConfig = {
  key: QuadrantKey;
  title: string;
  subtitle: string;
  urgent: boolean;
  important: boolean;
  className: string;
};

const MATRIX_QUADRANTS: QuadrantConfig[] = [
  { key: 'doFirst', title: 'Do First', subtitle: 'Urgent & Important', urgent: true, important: true, className: 'quadrantUrgentImportant' },
  { key: 'schedule', title: 'Schedule', subtitle: 'Important, Not Urgent', urgent: false, important: true, className: 'quadrantImportant' },
  { key: 'delegate', title: 'Delegate', subtitle: 'Urgent, Not Important', urgent: true, important: false, className: 'quadrantUrgent' },
  { key: 'eliminate', title: 'Eliminate', subtitle: 'Not Urgent, Not Important', urgent: false, important: false, className: 'quadrantNeither' },
];

function compareMatrixLegacy(a: TodoItemWithId, b: TodoItemWithId) {
  return (a.etsDateTime || '').localeCompare(b.etsDateTime || '') ||
    a.subject.localeCompare(b.subject) ||
    a.id.localeCompare(b.id);
}

// TodoCard component for rendering individual todo items
function TodoCard({ todo, onClick, onStatusChange }: {
  todo: TodoItemWithId,
  onClick?: (todo: TodoItemWithId) => void,
  onStatusChange?: (todo: TodoItemWithId, newStatus: TodoStatus) => void
}) {
  const currentStatus = todo.status || 'new';
  const bumpedFrom = describeDateBump(todo);
  // The backend refuses writes to an item whose saved data it could not read,
  // so offering the status buttons would only produce a failed save.
  const writesBlocked = todo.dataUnreadable === true;

  const handleStatusClick = (e: React.MouseEvent<HTMLButtonElement>, status: TodoStatus) => {
    e.stopPropagation(); // Prevent card click when clicking status
    if (status !== currentStatus && onStatusChange) {
      onStatusChange(todo, status);
    }
  };

  return (
    <div
      className={styles.todoCard}
      onClick={() => onClick?.(todo)}
    >
      <div className={styles.todoHeader}>
        {/*
          The card is a plain container: it holds the status buttons, so giving
          it a widget role would make screen readers present the whole card as
          one control and hide those buttons. The title carries the open action
          instead.
        */}
        <h4 className={styles.todoTitle}>
          <button
            type="button"
            className={styles.todoTitleButton}
            onClick={(e) => {
              e.stopPropagation();
              onClick?.(todo);
            }}
          >
            {todo.subject}
          </button>
        </h4>
      </div>
      
      <div className={styles.statusContainer}>
        {ALL_STATUSES.map((status) => (
          <button
            key={status}
            className={`${styles.statusBadge} ${styles[`status_${status}`]} ${status === currentStatus ? styles.statusActive : ''}`}
            onClick={(e) => handleStatusClick(e, status)}
            disabled={writesBlocked}
            title={writesBlocked
              ? 'Changing status is disabled while this item\u2019s saved data cannot be read'
              : `Set status to ${STATUS_LABELS[status]}`}
            aria-pressed={status === currentStatus}
          >
            {STATUS_LABELS[status]}
          </button>
        ))}
      </div>
      
      {/* Dates section - compact layout */}
      {(todo.etsDateTime || todo.etaDateTime || todo.startDateTime || todo.finishDateTime || bumpedFrom) && (
        <div className={styles.todoDates}>
          {/* Planned times */}
          {(todo.etsDateTime || todo.etaDateTime) && (
            <div className={styles.todoDateRow}>
              <span className={styles.todoDateLabel}>Planned:</span>
              {todo.etsDateTime && (() => {
                const ets = formatRelativeDate(todo.etsDateTime);
                return (
                  <span
                    className={styles.todoDateValue}
                    title={`ETS: ${ets.fullDate}`}
                  >
                    {ets.text}
                  </span>
                );
              })()}
              {todo.etsDateTime && todo.etaDateTime && <span className={styles.todoDateSep}>→</span>}
              {todo.etaDateTime && (() => {
                const isOpen = todo.status !== 'finished' && todo.status !== 'cancelled';
                const eta = formatRelativeDate(todo.etaDateTime, new Date(), isOpen ? 'deadline' : 'moment');
                return (
                  <span 
                    className={`${styles.todoDateValue} ${isOpen && eta.isOverdue ? styles.todoDateOverdue : ''}`}
                    title={`ETA: ${eta.fullDate}`}
                  >
                    {eta.text}
                  </span>
                );
              })()}
              {bumpedFrom && (
                <span
                  className={styles.todoDateBumped}
                  title={bumpedFrom.tooltip}
                  aria-label={bumpedFrom.tooltip}
                >
                  ↻ moved
                </span>
              )}
            </div>
          )}
          {bumpedFrom && (
            <div className={styles.todoDateRow}>
              <span className={styles.todoDateLabel}>Originally:</span>
              <span className={styles.todoDateValue} title={bumpedFrom.tooltip}>
                {bumpedFrom.text}
              </span>
            </div>
          )}
          {/* Actual times */}
          {(todo.startDateTime || todo.finishDateTime) && (
            <div className={styles.todoDateRow}>
              <span className={styles.todoDateLabel}>Actual:</span>
              {todo.startDateTime && (() => {
                const started = formatRelativeDate(todo.startDateTime);
                return (
                  <span
                    className={styles.todoDateValue}
                    title={`Started: ${started.fullDate}`}
                  >
                    {started.text}
                  </span>
                );
              })()}
              {todo.startDateTime && todo.finishDateTime && <span className={styles.todoDateSep}>→</span>}
              {todo.finishDateTime && (() => {
                const finished = formatRelativeDate(todo.finishDateTime);
                return (
                  <span
                    className={styles.todoDateValue}
                    title={`Finished: ${finished.fullDate}`}
                  >
                    {finished.text}
                  </span>
                );
              })()}
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
        const done = countCheckedEntries(todo.checklist);
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
  } = useBookId('/matrix');
  const bookIdRef = useRef(bookId);
  const sweepAttemptedRef = useRef(false);
  const mutationVersionRef = useRef(0);
  const isSavingOrderRef = useRef(false);
  const pendingMutationCountRef = useRef(0);
  const pendingFetchRef = useRef(false);
  const pendingFetchPreserveErrorRef = useRef(false);
  // Set when a write failed and its optimistic change was rolled back: the view
  // is then a guess until a fetch succeeds, because a rejected multi-item write
  // may still have partly landed.
  const unverifiedWriteRef = useRef<{ bookId: string; message: string } | null>(null);
  // Reads already in flight when the user dismissed the banner: their failures
  // belong to a message that has been closed, so they are not reported.
  const dismissedFetchSequenceRef = useRef(0);
  const pendingFetchInteractionRef = useRef<AuthInteraction>('allow-interactive');
  const fetchSequenceRef = useRef(0);
  bookIdRef.current = bookId;

  const [todoItems, setTodoItems] = useState<TodoItemWithId[]>([]);
  const [itemsBookId, setItemsBookId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authRecoveryRequired, setAuthRecoveryRequired] = useState(false);
  const [draggedItem, setDraggedItem] = useState<TodoItemWithId | null>(null);
  const [selectedTodo, setSelectedTodo] = useState<TodoItemWithId | null>(null);
  const [zoomedQuadrant, setZoomedQuadrant] = useState<QuadrantKey | null>(null);
  const taskQuery = useTaskQuery(bookId);
  const { query } = taskQuery;
  const [showFilters, setShowFilters] = useState(false);
  const [showTags, setShowTags] = useState(true);
  const statusPanelId = useId();
  const tagsPanelId = useId();
  const closeStatusPanel = useCallback(() => setShowFilters(false), []);
  const closeTagsPanel = useCallback(() => setShowTags(false), []);
  const statusPanel = useDismissiblePanel<HTMLDivElement, HTMLButtonElement>(
    showFilters,
    closeStatusPanel,
  );
  const tagsPanel = useDismissiblePanel<HTMLDivElement, HTMLButtonElement>(
    showTags,
    closeTagsPanel,
    // The tag bar is open by default and sits in the page flow, so collapsing
    // it on every click elsewhere on the board would be hostile.
    { dismissOnOutsidePress: false },
  );
  const [showManageTags, setShowManageTags] = useState(false);
  const [isSavingOrder, setIsSavingOrder] = useState(false);

  // Escape leaves the zoomed quadrant, but anything layered on top of the board
  // owns the key first: dialogs, the dismissible filter panels, and dnd-kit's
  // "Escape cancels the drag". This listener is on the window in the bubble
  // phase, i.e. last, so by the time it runs every other handler has had its
  // say and the three cases below can be told apart.
  useEffect(() => {
    if (zoomedQuadrant === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Handlers that consume the key mark it; the dismissible panels do.
      if (event.defaultPrevented) return;
      // dnd-kit's pointer sensor cancels a drag on Escape without marking the
      // event, so collapsing the board mid-gesture has to be ruled out here.
      if (draggedItem !== null) return;
      // Dialogs close themselves without marking the event either, but they
      // are still mounted at this point.
      if (document.querySelector('[role="dialog"]')) return;
      setZoomedQuadrant(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomedQuadrant, draggedItem]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableTodoKeyboardCoordinates }),
  );

  // Merge book-level errors into the page error state
  const displayError = error || bookError;
  const requiresAuthRecovery = authRecoveryRequired || bookAuthRecoveryRequired;

  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const todo of todoItems) {
      if (todo.categories) {
        for (const c of todo.categories) cats.add(c);
      }
    }
    return Array.from(cats).sort((a, b) => a.localeCompare(b));
  }, [todoItems]);

  const categoryFilterActive = isCategoryFilterActive(query);

  // Deliberately not memoized: today-only filtering depends on the current
  // date, so results must refresh on re-render rather than stick across midnight.
  // One clock for both passes, so the count and the explanation of what is
  // hidden can never straddle midnight and disagree.
  const filterClock = new Date();
  const filteredTodoItems = filterTasks(todoItems, query, { now: filterClock });
  const hiddenByStatus = summarizeHiddenByStatus(todoItems, query, filterClock);

  const canonicalQuadrants = useMemo(() => ({
    doFirst: sortByPersistedOrder(
      todoItems.filter(todo => todo.urgent === true && todo.important === true),
      'matrixOrder',
      compareMatrixLegacy,
    ),
    schedule: sortByPersistedOrder(
      todoItems.filter(todo => todo.urgent !== true && todo.important === true),
      'matrixOrder',
      compareMatrixLegacy,
    ),
    delegate: sortByPersistedOrder(
      todoItems.filter(todo => todo.urgent === true && todo.important !== true),
      'matrixOrder',
      compareMatrixLegacy,
    ),
    eliminate: sortByPersistedOrder(
      todoItems.filter(todo => todo.urgent !== true && todo.important !== true),
      'matrixOrder',
      compareMatrixLegacy,
    ),
  }), [todoItems]);

  const visibleTodoIds = useMemo(
    () => new Set(filteredTodoItems.map(todo => todo.id)),
    [filteredTodoItems],
  );

  const quadrants = useMemo(() => ({
    doFirst: canonicalQuadrants.doFirst.filter(todo => visibleTodoIds.has(todo.id)),
    schedule: canonicalQuadrants.schedule.filter(todo => visibleTodoIds.has(todo.id)),
    delegate: canonicalQuadrants.delegate.filter(todo => visibleTodoIds.has(todo.id)),
    eliminate: canonicalQuadrants.eliminate.filter(todo => visibleTodoIds.has(todo.id)),
  }), [canonicalQuadrants, visibleTodoIds]);

  const queuePendingFetch = (
    preserveError: boolean,
    interaction: AuthInteraction,
  ) => {
    if (!pendingFetchRef.current) {
      pendingFetchInteractionRef.current = interaction;
    } else if (interaction === 'allow-interactive') {
      pendingFetchInteractionRef.current = 'allow-interactive';
    }
    pendingFetchRef.current = true;
    pendingFetchPreserveErrorRef.current ||= preserveError;
  };

  const fetchEvents = async ({
    preserveError = false,
    interaction = 'allow-interactive',
  }: FetchEventsOptions = {}) => {
    const requestedBookId = bookIdRef.current;
    if (!isAuthenticated || !requestedBookId) return;
    if (isSavingOrderRef.current || pendingMutationCountRef.current > 0) {
      queuePendingFetch(preserveError, interaction);
      return;
    }
    const requestedMutationVersion = mutationVersionRef.current;
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
      setError(previous => (bannerDerivesFrom(previous, strayWrite.message, 'board') ? null : previous));
    }

    try {
      // Fetch events from last 30 days to next 30 days
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const startDate = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      const endDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

      const todos = await store.listItems(requestedBookId, {
        range: 'window',
        fromDate: startDate.toISOString(),
        toDate: endDate.toISOString(),
        interaction,
      });
      if (fetchSequenceRef.current !== fetchSequence) return;
      if (
        bookIdRef.current !== requestedBookId ||
        mutationVersionRef.current !== requestedMutationVersion
      ) {
        if (bookIdRef.current === requestedBookId) {
          queuePendingFetch(preserveError, interaction);
          if (pendingMutationCountRef.current === 0) {
            queueMicrotask(() => {
              if (pendingFetchRef.current && pendingMutationCountRef.current === 0) {
                const replayPreserveError = pendingFetchPreserveErrorRef.current;
                pendingFetchRef.current = false;
                pendingFetchPreserveErrorRef.current = false;
                pendingFetchInteractionRef.current = 'allow-interactive';
                void fetchEvents({
                  preserveError: replayPreserveError,
                  interaction: 'silent-only',
                });
              }
            });
          }
        }
        return;
      }
      setTodoItems(todos);
      if (unverifiedWriteRef.current) {
        // This read is authoritative, so the board is no longer a guess. The
        // write failure itself stays: the user still needs to know it failed.
        setError(unverifiedWriteRef.current.message);
        unverifiedWriteRef.current = null;
      }
      setItemsBookId(requestedBookId);
      setAuthRecoveryRequired(false);

      // Sweep stale items across ALL books once per session (non-blocking; per-load ref prevents retries on failure)
      if (
        store.activeBackend === 'calendar' &&
        !hasSessionSweepRun() &&
        !isSessionSweepInProgress() &&
        !sweepAttemptedRef.current
      ) {
        sweepAttemptedRef.current = true;
        markSessionSweepInProgress();
        const sweepBookId = requestedBookId;
        const sweepMutationVersion = mutationVersionRef.current;
        const snapshotBooks = books.length > 0 ? [...books] : null;
        void (async () => {
          try {
            const sweepBooks = (
              snapshotBooks ?? (await store.listBooks({ interaction: 'silent-only' }))
            ).filter(book => book.canEdit !== false);
            const CONCURRENCY = 5;
            let i = 0;
            let hasFailure = false;
            const processNext = async () => {
              while (i < sweepBooks.length) {
                const book = sweepBooks[i++];
                try {
                  const calItems = await store.listItems(book.id, {
                    range: 'window',
                    fromDate: startDate.toISOString(),
                    toDate: endDate.toISOString(),
                    interaction: 'silent-only',
                  });
                  await store.calendar.sweepStaleItems(book.id, calItems, {
                    interaction: 'silent-only',
                  });
                } catch (calError) {
                  hasFailure = true;
                  console.error(`Error sweeping book ${book.id}:`, calError);
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
                const refreshed = await store.listItems(sweepBookId, {
                  range: 'window',
                  fromDate: startDate.toISOString(),
                  toDate: endDate.toISOString(),
                  interaction: 'silent-only',
                });
                if (
                  bookIdRef.current === sweepBookId &&
                  mutationVersionRef.current === sweepMutationVersion
                ) {
                  setTodoItems(refreshed);
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
    } catch (err: unknown) {
      console.error('Error fetching events:', err);
      if (
        fetchSequenceRef.current === fetchSequence &&
        bookIdRef.current === requestedBookId
      ) {
        if (
          interaction === 'silent-only' &&
          isInteractiveAuthenticationRequiredError(err)
        ) {
          setAuthRecoveryRequired(true);
          setError(null);
          return;
        }
        const message = describeFailure('Could not load the board.', err);
        if (fetchSequence <= dismissedFetchSequenceRef.current) {
          // This read was already running when the user dismissed the banner.
          // Reporting it now would reopen something they closed.
          return;
        }
        // Always composed from the write failure, never from the banner, so a
        // run of failed refreshes replaces its clause instead of stacking, and
        // a rolled-back write keeps saying it is unverified until a read
        // proves otherwise.
        setError(composeReconcileFailure(unverifiedWriteRef.current?.message ?? null, message, 'board'));
      }
    } finally {
      if (fetchSequenceRef.current === fetchSequence && bookIdRef.current === requestedBookId) {
        setLoading(false);
      }
    }
  };

  const beginMutation = () => {
    pendingMutationCountRef.current += 1;
  };

  const finishMutation = () => {
    pendingMutationCountRef.current = Math.max(0, pendingMutationCountRef.current - 1);
    if (pendingMutationCountRef.current === 0 && pendingFetchRef.current) {
      const preserveError = pendingFetchPreserveErrorRef.current;
      pendingFetchRef.current = false;
      pendingFetchPreserveErrorRef.current = false;
      pendingFetchInteractionRef.current = 'allow-interactive';
      void fetchEvents({ preserveError, interaction: 'silent-only' });
    }
  };

  const { moveTodo, moveBlockedIds } = useMoveTodo({
    bookId,
    setItems: setTodoItems,
    setSelected: setSelectedTodo,
    beginMutation: () => {
      // Reads already in flight hold a copy of the row this move removes.
      mutationVersionRef.current += 1;
      beginMutation();
    },
    finishMutation,
    isCurrentBook: id => bookIdRef.current === id,
  });

  const handleAddTodo = async (todoItem: TodoItem) => {
    if (!bookId) {
      throw new Error('No book selected');
    }
    const operationBookId = bookId;

    mutationVersionRef.current += 1;
    beginMutation();
    try {
      const status = todoItem.status || 'new';
      const matrixPeers = todoItems.filter(item =>
        Boolean(item.urgent) === Boolean(todoItem.urgent) &&
        Boolean(item.important) === Boolean(todoItem.important)
      );
      const scrumPeers = todoItems.filter(item => (item.status || 'new') === status);
      const newTodo = await store.createItem(operationBookId, {
        ...todoItem,
        matrixOrder: todoItem.matrixOrder ?? nextOrder(matrixPeers, 'matrixOrder'),
        scrumOrder: todoItem.scrumOrder ?? nextOrder(scrumPeers, 'scrumOrder'),
      });
      if (bookIdRef.current !== operationBookId) return;
      setTodoItems(prev => [...prev, newTodo]);
    } catch (err: unknown) {
      console.error('Error creating TODO item:', err);
      const message = describeFailure('Could not add the task.', err);
      throw new Error(message);
    } finally {
      finishMutation();
    }
  };

  const quadrantId = (urgent: boolean, important: boolean) =>
    `matrix:${urgent ? 'urgent' : 'not-urgent'}:${important ? 'important' : 'not-important'}`;

  const parseQuadrantId = (id: string) => {
    const [, urgency, importance] = id.split(':');
    return {
      urgent: urgency === 'urgent',
      important: importance === 'important',
    };
  };

  const itemsInQuadrant = (urgent: boolean, important: boolean) => {
    if (urgent && important) return canonicalQuadrants.doFirst;
    if (!urgent && important) return canonicalQuadrants.schedule;
    if (urgent && !important) return canonicalQuadrants.delegate;
    return canonicalQuadrants.eliminate;
  };

  /**
   * Takes an optimistic update back after the write was rejected.
   *
   * Only safe while nothing else has happened since: a newer mutation or a book
   * switch means the snapshot no longer describes the rows on screen, and the
   * queued refetch is then the only correct way to reconcile.
   */
  const revertOptimisticUpdate = (
    snapshot: TodoItemWithId[],
    mutationVersion: number,
    operationBookId: string,
  ) => {
    if (bookIdRef.current !== operationBookId) return;
    if (mutationVersionRef.current !== mutationVersion) return;
    setTodoItems(items => restoreSnapshot(items, snapshot));
    setSelectedTodo(current => {
      if (!current) return current;
      return snapshot.find(item => item.id === current.id) ?? current;
    });
  };

  const mergePersistedSources = (persistedItems: TodoItemWithId[]) => {
    const sources = new Map<string, NonNullable<TodoItemWithId['source']>>();
    for (const item of persistedItems) {
      if (item.source) sources.set(item.id, item.source);
    }
    if (sources.size === 0) return;
    setTodoItems(items => items.map(item => {
      const source = sources.get(item.id);
      return source ? { ...item, source } : item;
    }));
    setSelectedTodo(current => {
      if (!current) return current;
      const source = sources.get(current.id);
      return source ? { ...current, source } : current;
    });
  };

  const persistUpdates = async (updates: Map<string, Partial<TodoItem>>) => {
    if (!bookId) throw new Error('No book selected');
    const persistedItems = await store.updateItems(
      bookId,
      Array.from(updates, ([itemId, fields]) => ({ itemId, updates: fields })),
    );
    if (bookIdRef.current === bookId) mergePersistedSources(persistedItems);
  };

  const handleDragStart = (event: DragStartEvent) => {
    const todo = todoItems.find(item => item.id === String(event.active.id));
    setDraggedItem(todo ?? null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setDraggedItem(null);
    if (!over || !bookId || isSavingOrder) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    const sourceId = active.data.current?.containerId as string | undefined;
    const destinationId = over.data.current?.containerId as string | undefined;
    if (!sourceId || !destinationId) return;

    const sourceFlags = parseQuadrantId(sourceId);
    const destinationFlags = parseQuadrantId(destinationId);
    const sourceItems = itemsInQuadrant(sourceFlags.urgent, sourceFlags.important);
    const destinationItems = sourceId === destinationId
      ? sourceItems
      : itemsInQuadrant(destinationFlags.urgent, destinationFlags.important);

    let replacements: TodoItemWithId[];
    const updates = new Map<string, Partial<TodoItem>>();

    if (sourceId === destinationId) {
      const visibleItems = Object.values(quadrants).flat().filter(item =>
        Boolean(item.urgent) === sourceFlags.urgent &&
        Boolean(item.important) === sourceFlags.important
      );
      const visibleIds = new Set(visibleItems.map(item => item.id));
      const targetId = visibleIds.has(overId) ? overId : visibleItems.at(-1)?.id;
      if (!targetId) return;
      const reordered = reorderVisibleItems(sourceItems, visibleIds, activeId, targetId);
      const normalized = normalizeOrder(reordered, 'matrixOrder');
      replacements = normalized.items;
      for (const item of normalized.changed) {
        updates.set(item.id, { matrixOrder: item.matrixOrder });
      }
    } else {
      const activeRect = active.rect.current.translated;
      const insertAfter = overId !== destinationId &&
        activeRect !== null &&
        activeRect.top + activeRect.height / 2 > over.rect.top + over.rect.height / 2;
      const moved = moveBetweenContainers(
        sourceItems,
        destinationItems,
        activeId,
        overId === destinationId ? undefined : overId,
        insertAfter,
      );
      const movedDestination = moved.destination.map(item => item.id === activeId
        ? { ...item, ...destinationFlags }
        : item
      );
      const normalizedSource = normalizeOrder(moved.source, 'matrixOrder');
      const normalizedDestination = normalizeOrder(movedDestination, 'matrixOrder');
      replacements = [...normalizedSource.items, ...normalizedDestination.items];
      for (const item of [...normalizedSource.changed, ...normalizedDestination.changed]) {
        updates.set(item.id, { matrixOrder: item.matrixOrder });
      }
      updates.set(activeId, {
        ...updates.get(activeId),
        urgent: destinationFlags.urgent,
        important: destinationFlags.important,
      });
    }

    const orderSnapshot = snapshotItems(todoItems, replacements.map(item => item.id));
    // An item whose saved data could not be read is refused by the stores, and
    // one of them in the quadrant would otherwise fail the whole batch.
    const writableUpdates = dropUnwritableUpdates(updates, todoItems);
    const shownReplacements = keepStoredOrder(replacements, todoItems, 'matrixOrder');
    setTodoItems(items => replaceItems(items, shownReplacements));
    setError(null);
    mutationVersionRef.current += 1;
    const orderMutationVersion = mutationVersionRef.current;
    isSavingOrderRef.current = true;
    setIsSavingOrder(true);
    beginMutation();

    try {
      await persistUpdates(writableUpdates);
    } catch (err: unknown) {
      console.error('Error updating Matrix order:', err);
      revertOptimisticUpdate(orderSnapshot, orderMutationVersion, bookId);
      const writeMessage = describeFailure('Could not save the new order.', err);
      // Held until a read proves the board: a bulk write can partly succeed
      // and still reject, so the restored list is a guess until then.
      unverifiedWriteRef.current = { bookId, message: writeMessage };
      setError(writeMessage);
      pendingFetchRef.current = true;
      pendingFetchPreserveErrorRef.current = true;
    } finally {
      isSavingOrderRef.current = false;
      setIsSavingOrder(false);
      finishMutation();
    }
  };

  const handleStatusChange = async (todo: TodoItemWithId, newStatus: TodoStatus) => {
    if (!bookId) return;
    const operationBookId = bookId;
    mutationVersionRef.current += 1;
    const statusMutationVersion = mutationVersionRef.current;
    const statusSnapshot = snapshotItems(todoItems, [todo.id]);
    beginMutation();

    const now = new Date().toISOString();
    const updatedTimestamps = statusTimestampUpdates(todo, newStatus, now);
    const scrumOrder = nextOrder(
      todoItems.filter(item => item.id !== todo.id && (item.status || 'new') === newStatus),
      'scrumOrder',
    );

    setTodoItems(items =>
      items.map(item =>
        item.id === todo.id
          ? { ...item, status: newStatus, scrumOrder, ...updatedTimestamps }
          : item
      )
    );

    try {
      const updated = await store.updateItem(
        operationBookId,
        todo.id,
        { status: newStatus, scrumOrder, ...updatedTimestamps },
      );
      if (bookIdRef.current === operationBookId) mergePersistedSources([updated]);
    } catch (err: unknown) {
      console.error('Error updating TODO status:', err);
      if (bookIdRef.current !== operationBookId) return;
      revertOptimisticUpdate(statusSnapshot, statusMutationVersion, operationBookId);
      const message = describeFailure('Could not change the status.', err);
      const writeMessage = message;
      // Held until a read proves the board: a bulk write can partly succeed
      // and still reject, so the restored list is a guess until then.
      unverifiedWriteRef.current = { bookId: operationBookId, message: writeMessage };
      setError(writeMessage);
      pendingFetchRef.current = true;
      pendingFetchPreserveErrorRef.current = true;
    } finally {
      finishMutation();
    }
  };

  const handleUpdateTodo = async (updatedFields: Partial<TodoItem>) => {
    if (!selectedTodo?.id || !bookId) return;
    const operationBookId = bookId;
    mutationVersionRef.current += 1;
    const updateMutationVersion = mutationVersionRef.current;
    const updateSnapshot = snapshotItems(todoItems, [selectedTodo.id]);
    beginMutation();

    const persistedFields: Partial<TodoItem> = { ...updatedFields };
    const nextUrgent = updatedFields.urgent !== undefined ? updatedFields.urgent : Boolean(selectedTodo.urgent);
    const nextImportant = updatedFields.important !== undefined ? updatedFields.important : Boolean(selectedTodo.important);
    if (nextUrgent !== Boolean(selectedTodo.urgent) || nextImportant !== Boolean(selectedTodo.important)) {
      persistedFields.matrixOrder = nextOrder(
        todoItems.filter(item =>
          item.id !== selectedTodo.id &&
          Boolean(item.urgent) === nextUrgent &&
          Boolean(item.important) === nextImportant
        ),
        'matrixOrder',
      );
    }
    const nextStatus = updatedFields.status ?? selectedTodo.status ?? 'new';
    if (nextStatus !== (selectedTodo.status || 'new')) {
      persistedFields.scrumOrder = nextOrder(
        todoItems.filter(item => item.id !== selectedTodo.id && (item.status || 'new') === nextStatus),
        'scrumOrder',
      );
      // The stores derive these from the transition too, but only the caller
      // can keep the item on screen in step with them.
      Object.assign(
        persistedFields,
        statusTimestampUpdates(selectedTodo, nextStatus, new Date().toISOString()),
      );
    }

    // The stores drop the pre-bump original for a date the caller sets, so the
    // "moved" notice has to go with the same edit rather than wait for a read.
    const optimisticFields: Partial<TodoItem> = { ...persistedFields };
    if (updatedFields.etsDateTime !== undefined) optimisticFields.originalEtsDateTime = null;
    if (updatedFields.etaDateTime !== undefined) optimisticFields.originalEtaDateTime = null;

    setTodoItems(items =>
      items.map(item =>
        item.id === selectedTodo.id ? { ...item, ...optimisticFields } : item
      )
    );
    setSelectedTodo(prev => prev ? { ...prev, ...optimisticFields } : prev);

    try {
      const updated = await store.updateItem(
        operationBookId,
        selectedTodo.id,
        persistedFields,
      );
      if (bookIdRef.current === operationBookId) mergePersistedSources([updated]);
    } catch (err: unknown) {
      console.error('Error updating TODO:', err);
      if (bookIdRef.current !== operationBookId) return;
      revertOptimisticUpdate(updateSnapshot, updateMutationVersion, operationBookId);
      // The overlay closes even though the revert restored its copy: the error
      // banner lives on the page behind it, so leaving it open would hide the
      // explanation. The board itself keeps the reverted values.
      setSelectedTodo(null);
      const writeMessage = describeFailure('Could not save your changes.', err);
      // Held until a read proves the board: a bulk write can partly succeed
      // and still reject, so the restored list is a guess until then.
      unverifiedWriteRef.current = { bookId: operationBookId, message: writeMessage };
      setError(writeMessage);
      pendingFetchRef.current = true;
      pendingFetchPreserveErrorRef.current = true;
      throw err;
    } finally {
      finishMutation();
    }
  };

  const bulkUpdateCategories = async (
    affectedItems: TodoItemWithId[],
    computeNewCategories: (item: TodoItemWithId) => string[],
    updateFilterState: () => void,
  ): Promise<boolean> => {
    // Resolves to whether the backend accepted the change, so callers can gate
    // the saved-preset rewrite on it. Switching books mid-flight does not make
    // the rewrite wrong: it targets the book the operation started on.
    if (!bookId) return false;
    if (affectedItems.length === 0) return true;
    // An item whose saved data could not be read would be refused by the store
    // and take the whole batch with it, leaving the tag unchanged everywhere.
    const { writable: writableItems, skipped } = partitionWritableItems(affectedItems);
    const skippedNotice = describeSkippedUnwritable(skipped.length);
    if (writableItems.length === 0) {
      if (skippedNotice) setError(skippedNotice);
      return false;
    }
    const operationBookId = bookId;
    mutationVersionRef.current += 1;
    const tagsMutationVersion = mutationVersionRef.current;
    const tagsSnapshot = snapshotItems(todoItems, writableItems.map(item => item.id));
    beginMutation();

    const affectedIds = new Set(writableItems.map(a => a.id));

    setTodoItems(items =>
      items.map(item =>
        affectedIds.has(item.id)
          ? { ...item, categories: computeNewCategories(item) }
          : item
      )
    );
    updateFilterState();

    try {
      const updated = await store.updateItems(
        operationBookId,
        writableItems.map(item => ({
          itemId: item.id,
          updates: {
            categories: computeNewCategories(item),
          },
        })),
      );
      // The backend change landed, so saved filters for that book must be
      // rewritten either way; only the on-screen merge is book-specific.
      if (bookIdRef.current === operationBookId) mergePersistedSources(updated);
      if (skippedNotice && bookIdRef.current === operationBookId) setError(skippedNotice);
      return true;
    } catch (err: unknown) {
      console.error('Error updating tags:', err);
      if (bookIdRef.current !== operationBookId) return false;
      revertOptimisticUpdate(tagsSnapshot, tagsMutationVersion, operationBookId);
      taskQuery.clearCategoryFilters();
      const writeMessage = describeFailure('Could not update the tags.', err);
      // Held until a read proves the board: a bulk write can partly succeed
      // and still reject, so the restored list is a guess until then.
      unverifiedWriteRef.current = { bookId: operationBookId, message: writeMessage };
      setError(writeMessage);
      pendingFetchRef.current = true;
      pendingFetchPreserveErrorRef.current = true;
      throw err;
    } finally {
      finishMutation();
    }
  };

  const handleDeleteTag = async (tag: string) => {
    const affected = todoItems.filter(item => item.categories?.includes(tag));
    const applied = await bulkUpdateCategories(
      affected,
      (item) => (item.categories || []).filter(c => c !== tag),
      () => taskQuery.renameCategoryFilter(tag, null),
    );
    // Only rewrite persisted presets once the backend update has succeeded.
    if (applied) taskQuery.commitCategoryRenameToPresets(tag, null);
  };

  const handleRenameTag = async (oldTag: string, newTag: string) => {
    const affected = todoItems.filter(item => item.categories?.includes(oldTag));
    const applied = await bulkUpdateCategories(
      affected,
      (item) => (item.categories || []).map(c => c === oldTag ? newTag : c),
      () => taskQuery.renameCategoryFilter(oldTag, newTag),
    );
    if (applied) taskQuery.commitCategoryRenameToPresets(oldTag, newTag);
  };

  const handleMergeTag = async (sourceTag: string, targetTag: string) => {
    const affected = todoItems.filter(item => item.categories?.includes(sourceTag));
    const applied = await bulkUpdateCategories(
      affected,
      (item) => {
        const cats = item.categories || [];
        const without = cats.filter(c => c !== sourceTag);
        return without.includes(targetTag) ? without : [...without, targetTag];
      },
      () => taskQuery.renameCategoryFilter(sourceTag, targetTag),
    );
    if (applied) taskQuery.commitCategoryRenameToPresets(sourceTag, targetTag);
  };

  const handleLogin = async () => {
    setError(null);
    try {
      await auth.login();
    } catch (error) {
      console.error('Login failed:', error);
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

  useEffect(() => {
    if (bookId && bookId !== itemsBookId) {
      setLoading(isAuthenticated && !busy);
      setTodoItems([]);
      setSelectedTodo(null);
    }
  }, [bookId, itemsBookId, isAuthenticated, busy]);

  useEffect(() => {
    if (isAuthenticated && !busy && bookId) {
      fetchEvents({ interaction: 'silent-only' });
    }
  }, [isAuthenticated, busy, bookId]);

  useRefreshOnPageActivation(
    () => void fetchEvents({
      preserveError: true,
      interaction: 'silent-only',
    }),
    isAuthenticated &&
      !requiresAuthRecovery &&
      !busy &&
      !!bookId &&
      !loading &&
      !isSavingOrder,
  );

  // Push page actions into the shared top bar
  useSetTopBarActions(
    isAuthenticated && !requiresAuthRecovery && books.length > 1 ? (
      <select
        className={styles.bookSwitcher}
        value={bookId || ''}
        onChange={(e) => handleBookSwitch(e.target.value)}
        disabled={isSavingOrder}
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
        <AddTodoItem onAddTodo={handleAddTodo} disabled={loading} availableCategories={allCategories} />
        <button
          onClick={() => void fetchEvents()}
          disabled={loading || isSavingOrder}
          className={`${styles.button} ${styles.buttonSecondary}`}
        >
          {loading ? 'Loading...' : isSavingOrder ? 'Saving...' : 'Refresh'}
        </button>
      </>
    ),
    [
      isAuthenticated,
      requiresAuthRecovery,
      busy,
      loading,
      isSavingOrder,
      bookId,
      books,
      allCategories,
      todoItems,
    ],
  );

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
            onDismiss={() => {
                unverifiedWriteRef.current = null;
                dismissedFetchSequenceRef.current = fetchSequenceRef.current;
                setError(null);
                setBookError(null);
              }}
          />
        )}

        {loading && (
          <div className={styles.loading}>
            <div className={styles.spinner}></div>
          </div>
        )}

        {!loading && (
            <div className={styles.matrixSection}>
              <TaskSearchBar
                query={query}
                queryActive={taskQuery.queryActive}
                resultCount={filteredTodoItems.length}
                totalCount={todoItems.length}
                hiddenSummary={hiddenByStatus.label}
                scopeNote="loads 30 days either side of today"
                onRevealHidden={() => taskQuery.revealStatuses(hiddenByStatus.statuses)}
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
                showPriorityFilters
                onToggleUrgentOnly={taskQuery.toggleUrgentOnly}
                onToggleImportantOnly={taskQuery.toggleImportantOnly}
              />
              <div className={styles.matrixHeader}>
                <span className={styles.filterCount} />
                <div className={styles.matrixHeaderActions}>
                  {allCategories.length > 0 && (
                    <div className={styles.comboButton}>
                      <button
                        ref={tagsPanel.triggerRef}
                        className={styles.comboButtonMain}
                        onClick={() => setShowTags(prev => !prev)}
                        aria-expanded={showTags}
                        aria-haspopup="true"
                        aria-controls={tagsPanelId}
                      >
                        {showTags ? '▲' : '▼'} Tags{categoryFilterActive ? ' ●' : ''}
                      </button>
                      <button
                        className={styles.comboButtonAction}
                        onClick={() => setShowManageTags(true)}
                        title="Manage tags"
                        aria-label="Manage tags"
                        aria-haspopup="dialog"
                      >
                        ⚙
                      </button>
                    </div>
                  )}
                  <button
                    ref={statusPanel.triggerRef}
                    className={`${styles.button} ${styles.buttonSecondary} ${styles.filterToggle}`}
                    onClick={() => setShowFilters(prev => !prev)}
                    aria-expanded={showFilters}
                    aria-haspopup="true"
                    aria-controls={statusPanelId}
                  >
                    {showFilters ? '▲ Status' : '▼ Status'}{isStatusFilterActive(query) ? ' ●' : ''}
                  </button>
                </div>
              </div>
              {showFilters && (
                <div className={styles.filterBar} id={statusPanelId} ref={statusPanel.panelRef}>
                  {ALL_STATUSES.map(status => (
                    <div key={status} className={styles.filterGroup}>
                      <span className={`${styles.filterLabel} ${styles[`status_${status}`]}`}>{STATUS_LABELS[status]}</span>
                      <div className={styles.filterModes}>
                        {FILTER_MODES.map(mode => (
                          <button
                            key={mode}
                            className={`${styles.filterMode} ${query.statusFilters[status] === mode ? styles.filterModeActive : ''}`}
                            onClick={() => taskQuery.setStatusFilter(status, mode)}
                            aria-pressed={query.statusFilters[status] === mode}
                          >
                            {FILTER_MODE_LABELS[mode]}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  {isStatusFilterActive(query) && (
                    <button
                      className={`${styles.filterMode} ${styles.categoryFilterClear}`}
                      onClick={taskQuery.resetStatusFilters}
                    >
                      ✕ Reset
                    </button>
                  )}
                </div>
              )}
              {showTags && allCategories.length > 0 && (
                <div className={styles.tagBar} id={tagsPanelId} ref={tagsPanel.panelRef}>
                  <div className={styles.categoryFilterChips}>
                      <button
                        className={`${styles.categoryFilterChip} ${query.includeUncategorized ? styles.categoryFilterChipActive : ''}`}
                        onClick={taskQuery.toggleUncategorized}
                        aria-pressed={query.includeUncategorized}
                      >
                        Untagged
                      </button>
                      {allCategories.map(cat => {
                        const isSelected = query.categories.includes(cat);
                        return (
                          <button
                            key={cat}
                            className={`${styles.categoryFilterChip} ${isSelected ? styles.categoryFilterChipActive : ''}`}
                            onClick={() => taskQuery.toggleCategory(cat)}
                            aria-pressed={isSelected}
                          >
                            {cat}
                          </button>
                        );
                      })}
                      {categoryFilterActive && (
                        <button
                          className={`${styles.categoryFilterChip} ${styles.categoryFilterClear}`}
                          onClick={taskQuery.clearCategoryFilters}
                        >
                          ✕ Clear
                        </button>
                      )}
                    </div>
                </div>
              )}
              <DndContext
                sensors={sensors}
                collisionDetection={sortableTodoCollisionDetection}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragCancel={() => setDraggedItem(null)}
              >
              <div className={`${styles.matrix} ${zoomedQuadrant ? styles.matrixZoomed : ''}`}>
                {MATRIX_QUADRANTS
                  .filter(q => zoomedQuadrant === null || q.key === zoomedQuadrant)
                  .map((q) => {
                    const items = quadrants[q.key];
                    const containerId = quadrantId(q.urgent, q.important);
                    const zoomed = zoomedQuadrant === q.key;
                    return (
                      <div key={q.key} className={`${styles.quadrant} ${styles[q.className]}`}>
                        <div className={styles.quadrantHeader}>
                          <div>
                            <h3 className={styles.quadrantTitle}>{q.title} ({items.length})</h3>
                            <p className={styles.quadrantSubtitle}>{q.subtitle}</p>
                          </div>
                          <div className={styles.quadrantHeaderActions}>
                            <AddTodoItem
                              onAddTodo={handleAddTodo}
                              disabled={loading}
                              defaultUrgent={q.urgent}
                              defaultImportant={q.important}
                              addLabel={`Add item to ${q.title}`}
                              compact={true}
                              availableCategories={allCategories}
                            />
                            <button
                              type="button"
                              className={styles.quadrantZoomButton}
                              aria-pressed={zoomed}
                              aria-label={`Zoom into ${q.title}`}
                              title={zoomed ? 'Show all quadrants (Esc)' : `Zoom into ${q.title} (hides the other quadrants, so cards cannot be dragged between them)`}
                              onClick={() => setZoomedQuadrant(zoomed ? null : q.key)}
                            >
                              {zoomed ? '\u2715' : '\u26F6'}
                            </button>
                          </div>
                        </div>
                        <SortableTodoList
                          id={containerId}
                          itemIds={items.map(todo => todo.id)}
                          className={styles.quadrantContent}
                        >
                          {items.map((todo) => (
                            <SortableTodo key={todo.id} id={todo.id} containerId={containerId} disabled={isSavingOrder || todo.dataUnreadable === true}>
                              <TodoCard
                                todo={todo}
                                onClick={isSavingOrder ? undefined : setSelectedTodo}
                                onStatusChange={isSavingOrder ? undefined : handleStatusChange}
                              />
                            </SortableTodo>
                          ))}
                          {items.length === 0 && (
                            <EmptyListMessage
                              filtered={taskQuery.queryActive}
                              onClearFilters={taskQuery.clearAll}
                              className={styles.quadrantEmpty}
                            />
                          )}
                        </SortableTodoList>
                      </div>
                    );
                  })}
              </div>
              <DragOverlay>
                {draggedItem ? (
                  <SortableTodoOverlay>
                    <TodoCard todo={draggedItem} />
                  </SortableTodoOverlay>
                ) : null}
              </DragOverlay>
              </DndContext>
            </div>
          )}

          {/* View Todo Dialog */}
          {selectedTodo && (
            <ViewTodoItem 
              todo={selectedTodo} 
              onClose={() => setSelectedTodo(null)}
              onUpdate={handleUpdateTodo}
              onMove={targetBookId => moveTodo(selectedTodo, targetBookId)}
              moveBlocked={moveBlockedIds.has(selectedTodo.id)}
              books={books}
              currentBookId={bookId}
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
  );
}
