'use client';

import React, { useState, useEffect, useMemo, useRef, Suspense } from 'react';
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
  moveBetweenContainers,
  nextOrder,
  normalizeOrder,
  reorderVisibleItems,
  replaceItems,
  sortByPersistedOrder,
} from '@/lib/orderUtils';
import { restoreSnapshot, snapshotItems } from '@/lib/optimisticUpdate';
import { composeReconcileFailure } from '@/lib/reconcileMessage';
import { statusTimestampUpdates } from '@/lib/statusTimestamps';
import { hasSessionSweepRun, isSessionSweepInProgress, markSessionSweepInProgress, clearSessionSweepInProgress, markSessionSweepDone } from '@/lib/bookStorage';
import { useAuthClient } from '@/lib/auth/useAuthClient';
import { isInteractiveAuthenticationRequiredError } from '@/lib/auth/errors';
import { useBookId } from '@/lib/hooks/useBookId';
import { useRefreshOnPageActivation } from '@/lib/hooks/useRefreshOnPageActivation';
import { useSetTopBarActions } from '@/components/TopBarProvider';
import AuthRecoveryPanel from '@/components/AuthRecoveryPanel';
import ErrorBanner from '@/components/ErrorBanner';
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
            title={`Set status to ${STATUS_LABELS[status]}`}
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
                const eta = formatRelativeDate(todo.etaDateTime);
                return (
                  <span 
                    className={`${styles.todoDateValue} ${eta.isOverdue ? styles.todoDateOverdue : ''}`}
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
  const taskQuery = useTaskQuery(bookId);
  const { query } = taskQuery;
  const [showFilters, setShowFilters] = useState(false);
  const [showTags, setShowTags] = useState(true);
  const [showManageTags, setShowManageTags] = useState(false);
  const [isSavingOrder, setIsSavingOrder] = useState(false);
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
    if (unverifiedWriteRef.current?.bookId !== requestedBookId) {
      // Switching book drops it: the message belongs to work the user is no
      // longer looking at, and a read of another book verifies nothing.
      unverifiedWriteRef.current = null;
    }
    if (!preserveError) setError(unverifiedWriteRef.current?.message ?? null);

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
        const message = err instanceof Error ? err.message : 'Failed to fetch events';
        // While a rolled-back write is still unverified, every failed refresh
        // has to keep saying so - not just the first one after the failure.
        // Always composed from the write failure, never from the banner, so a
      // run of failed refreshes replaces its clause instead of stacking.
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
      const message = err instanceof Error ? err.message : 'Failed to create TODO item';
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
    setTodoItems(items => replaceItems(items, replacements));
    setError(null);
    mutationVersionRef.current += 1;
    const orderMutationVersion = mutationVersionRef.current;
    isSavingOrderRef.current = true;
    setIsSavingOrder(true);
    beginMutation();

    try {
      await persistUpdates(updates);
    } catch (err: unknown) {
      console.error('Error updating Matrix order:', err);
      revertOptimisticUpdate(orderSnapshot, orderMutationVersion, bookId);
      const writeMessage = err instanceof Error ? err.message : 'Failed to save Matrix order';
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
      const message = err instanceof Error ? err.message : 'Failed to update status';
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
    }

    setTodoItems(items =>
      items.map(item =>
        item.id === selectedTodo.id ? { ...item, ...persistedFields } : item
      )
    );
    setSelectedTodo(prev => prev ? { ...prev, ...persistedFields } : prev);

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
      const writeMessage = err instanceof Error ? err.message : 'Failed to update TODO';
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
    const operationBookId = bookId;
    mutationVersionRef.current += 1;
    const tagsMutationVersion = mutationVersionRef.current;
    const tagsSnapshot = snapshotItems(todoItems, affectedItems.map(item => item.id));
    beginMutation();

    const affectedIds = new Set(affectedItems.map(a => a.id));

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
        affectedItems.map(item => ({
          itemId: item.id,
          updates: {
            categories: computeNewCategories(item),
          },
        })),
      );
      // The backend change landed, so saved filters for that book must be
      // rewritten either way; only the on-screen merge is book-specific.
      if (bookIdRef.current === operationBookId) mergePersistedSources(updated);
      return true;
    } catch (err: unknown) {
      console.error('Error updating tags:', err);
      if (bookIdRef.current !== operationBookId) return false;
      revertOptimisticUpdate(tagsSnapshot, tagsMutationVersion, operationBookId);
      taskQuery.clearCategoryFilters();
      const writeMessage = err instanceof Error ? err.message : 'Failed to update tags';
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
            onDismiss={() => { unverifiedWriteRef.current = null; setError(null); setBookError(null); }}
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
                        className={styles.comboButtonMain}
                        onClick={() => setShowTags(prev => !prev)}
                        aria-expanded={showTags}
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
                    className={`${styles.button} ${styles.buttonSecondary} ${styles.filterToggle}`}
                    onClick={() => setShowFilters(prev => !prev)}
                    aria-expanded={showFilters}
                  >
                    {showFilters ? '▲ Status' : '▼ Status'}{isStatusFilterActive(query) ? ' ●' : ''}
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
                <div className={styles.tagBar}>
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
              <div className={styles.matrix}>
                {/* Top-left: Urgent & Important */}
                <div 
                  className={`${styles.quadrant} ${styles.quadrantUrgentImportant}`}
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
                  <SortableTodoList
                    id={quadrantId(true, true)}
                    itemIds={quadrants.doFirst.map(todo => todo.id)}
                    className={styles.quadrantContent}
                  >
                    {quadrants.doFirst.map((todo) => (
                      <SortableTodo key={todo.id} id={todo.id} containerId={quadrantId(true, true)} disabled={isSavingOrder}>
                        <TodoCard
                          todo={todo}
                          onClick={isSavingOrder ? undefined : setSelectedTodo}
                          onStatusChange={isSavingOrder ? undefined : handleStatusChange}
                        />
                      </SortableTodo>
                    ))}
                    {quadrants.doFirst.length === 0 && (
                      <p className={styles.quadrantEmpty}>No items</p>
                    )}
                  </SortableTodoList>
                </div>

                {/* Top-right: Important but not Urgent */}
                <div 
                  className={`${styles.quadrant} ${styles.quadrantImportant}`}
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
                  <SortableTodoList
                    id={quadrantId(false, true)}
                    itemIds={quadrants.schedule.map(todo => todo.id)}
                    className={styles.quadrantContent}
                  >
                    {quadrants.schedule.map((todo) => (
                      <SortableTodo key={todo.id} id={todo.id} containerId={quadrantId(false, true)} disabled={isSavingOrder}>
                        <TodoCard
                          todo={todo}
                          onClick={isSavingOrder ? undefined : setSelectedTodo}
                          onStatusChange={isSavingOrder ? undefined : handleStatusChange}
                        />
                      </SortableTodo>
                    ))}
                    {quadrants.schedule.length === 0 && (
                      <p className={styles.quadrantEmpty}>No items</p>
                    )}
                  </SortableTodoList>
                </div>

                {/* Bottom-left: Urgent but not Important */}
                <div 
                  className={`${styles.quadrant} ${styles.quadrantUrgent}`}
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
                  <SortableTodoList
                    id={quadrantId(true, false)}
                    itemIds={quadrants.delegate.map(todo => todo.id)}
                    className={styles.quadrantContent}
                  >
                    {quadrants.delegate.map((todo) => (
                      <SortableTodo key={todo.id} id={todo.id} containerId={quadrantId(true, false)} disabled={isSavingOrder}>
                        <TodoCard
                          todo={todo}
                          onClick={isSavingOrder ? undefined : setSelectedTodo}
                          onStatusChange={isSavingOrder ? undefined : handleStatusChange}
                        />
                      </SortableTodo>
                    ))}
                    {quadrants.delegate.length === 0 && (
                      <p className={styles.quadrantEmpty}>No items</p>
                    )}
                  </SortableTodoList>
                </div>

                {/* Bottom-right: Neither Urgent nor Important */}
                <div 
                  className={`${styles.quadrant} ${styles.quadrantNeither}`}
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
                  <SortableTodoList
                    id={quadrantId(false, false)}
                    itemIds={quadrants.eliminate.map(todo => todo.id)}
                    className={styles.quadrantContent}
                  >
                    {quadrants.eliminate.map((todo) => (
                      <SortableTodo key={todo.id} id={todo.id} containerId={quadrantId(false, false)} disabled={isSavingOrder}>
                        <TodoCard
                          todo={todo}
                          onClick={isSavingOrder ? undefined : setSelectedTodo}
                          onStatusChange={isSavingOrder ? undefined : handleStatusChange}
                        />
                      </SortableTodo>
                    ))}
                    {quadrants.eliminate.length === 0 && (
                      <p className={styles.quadrantEmpty}>No items</p>
                    )}
                  </SortableTodoList>
                </div>
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
