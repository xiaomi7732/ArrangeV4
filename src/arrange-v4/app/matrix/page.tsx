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
import { formatRelativeDate, isDateToday } from '@/lib/dateUtils';
import {
  moveBetweenContainers,
  nextOrder,
  normalizeOrder,
  reorderVisibleItems,
  replaceItems,
  sortByPersistedOrder,
} from '@/lib/orderUtils';
import { hasSessionSweepRun, isSessionSweepInProgress, markSessionSweepInProgress, clearSessionSweepInProgress, markSessionSweepDone } from '@/lib/bookStorage';
import { useAuthClient } from '@/lib/auth/useAuthClient';
import { isInteractiveAuthenticationRequiredError } from '@/lib/auth/errors';
import { useBookId } from '@/lib/hooks/useBookId';
import { useRefreshOnPageActivation } from '@/lib/hooks/useRefreshOnPageActivation';
import { useSetTopBarActions } from '@/components/TopBarProvider';
import AuthRecoveryPanel from '@/components/AuthRecoveryPanel';
import AddTodoItem from '@/components/AddTodoItem';
import ViewTodoItem from '@/components/ViewTodoItem';
import ManageTags from '@/components/ManageTags';
import {
  SortableTodo,
  SortableTodoList,
  SortableTodoOverlay,
  sortableTodoCollisionDetection,
  sortableTodoKeyboardCoordinates,
} from '@/components/SortableTodo';
import Link from 'next/link';
import styles from './page.module.css';

type StatusFilterMode = 'showAll' | 'todayOnly' | 'hide';
type FetchEventsOptions = StoreOperationOptions & { preserveError?: boolean };

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

function passesTodayFilter(todo: TodoItem): boolean {
  const status = todo.status || 'new';
  if (status === 'finished') return isDateToday(todo.finishDateTime);
  return isDateToday(todo.etsDateTime);
}

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
  const auth = useAuthClient();
  const { isAuthenticated, busy } = auth;
  const store = useStore();
  const { bookId, books, handleBookSwitch, error: bookError } = useBookId('/matrix');
  const bookIdRef = useRef(bookId);
  const sweepAttemptedRef = useRef(false);
  const mutationVersionRef = useRef(0);
  const isSavingOrderRef = useRef(false);
  const pendingMutationCountRef = useRef(0);
  const pendingFetchRef = useRef(false);
  const pendingFetchPreserveErrorRef = useRef(false);
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
  const [statusFilters, setStatusFilters] = useState<Record<TodoStatus, StatusFilterMode>>(DEFAULT_STATUS_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [showTags, setShowTags] = useState(true);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [showUncategorized, setShowUncategorized] = useState(false);
  const [showManageTags, setShowManageTags] = useState(false);
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableTodoKeyboardCoordinates }),
  );

  // Merge book-level errors into the page error state
  const displayError = error || bookError;

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
    if (!preserveError) setError(null);

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
                const replayInteraction = pendingFetchInteractionRef.current;
                pendingFetchRef.current = false;
                pendingFetchPreserveErrorRef.current = false;
                pendingFetchInteractionRef.current = 'allow-interactive';
                void fetchEvents({
                  preserveError: replayPreserveError,
                  interaction: replayInteraction,
                });
              }
            });
          }
        }
        return;
      }
      setTodoItems(todos);
      setItemsBookId(requestedBookId);
      setAuthRecoveryRequired(false);

      // Sweep stale items across ALL books once per session (non-blocking; per-load ref prevents retries on failure)
      if (
        interaction === 'allow-interactive' &&
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
            const sweepBooks = snapshotBooks ?? (await store.listBooks({
              interaction: 'silent-only',
            }));
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
        setError(message);
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
      const interaction = pendingFetchInteractionRef.current;
      pendingFetchRef.current = false;
      pendingFetchPreserveErrorRef.current = false;
      pendingFetchInteractionRef.current = 'allow-interactive';
      void fetchEvents({ preserveError, interaction });
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

  const persistUpdates = async (updates: Map<string, Partial<TodoItem>>) => {
    if (!bookId) throw new Error('No book selected');
    const entries = Array.from(updates.entries());
    const results = await Promise.allSettled(
      entries.map(([itemId, fields]) => store.updateItem(bookId, itemId, fields)),
    );
    const failure = results.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
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

    setTodoItems(items => replaceItems(items, replacements));
    setError(null);
    mutationVersionRef.current += 1;
    isSavingOrderRef.current = true;
    setIsSavingOrder(true);
    beginMutation();

    try {
      await persistUpdates(updates);
    } catch (err: unknown) {
      console.error('Error updating Matrix order:', err);
      setError(err instanceof Error ? err.message : 'Failed to save Matrix order');
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
    beginMutation();

    const currentStatus = todo.status || 'new';
    const now = new Date().toISOString();

    // Calculate timestamp changes based on status transition
    const updatedTimestamps: Partial<TodoItem> = {};

    if (newStatus === 'inProgress' && !todo.startDateTime) {
      updatedTimestamps.startDateTime = now;
    }
    if (newStatus === 'new') {
      updatedTimestamps.startDateTime = undefined;
    }
    if (newStatus === 'finished') {
      if (!todo.startDateTime) updatedTimestamps.startDateTime = now;
      if (!todo.finishDateTime) updatedTimestamps.finishDateTime = now;
    }
    if (newStatus !== 'finished' && currentStatus === 'finished') {
      updatedTimestamps.finishDateTime = undefined;
    }
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
      await store.updateItem(operationBookId, todo.id, { status: newStatus, scrumOrder });
    } catch (err: unknown) {
      console.error('Error updating TODO status:', err);
      if (bookIdRef.current !== operationBookId) return;
      const message = err instanceof Error ? err.message : 'Failed to update status';
      setError(message);
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
      await store.updateItem(operationBookId, selectedTodo.id, persistedFields);
    } catch (err: unknown) {
      console.error('Error updating TODO:', err);
      if (bookIdRef.current !== operationBookId) return;
      setSelectedTodo(null);
      setError(err instanceof Error ? err.message : 'Failed to update TODO');
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
  ) => {
    if (!bookId || affectedItems.length === 0) return;
    const operationBookId = bookId;
    mutationVersionRef.current += 1;
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
      const CONCURRENCY = 5;
      let idx = 0;
      const worker = async () => {
        while (idx < affectedItems.length) {
          const item = affectedItems[idx++];
          await store.updateItem(operationBookId, item.id, {
            categories: computeNewCategories(item),
          });
        }
      };
      const results = await Promise.allSettled(
        Array.from({ length: Math.min(CONCURRENCY, affectedItems.length) }, () => worker()),
      );
      const failure = results.find(result => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
    } catch (err: unknown) {
      console.error('Error updating tags:', err);
      if (bookIdRef.current !== operationBookId) return;
      setSelectedCategories(new Set());
      setShowUncategorized(false);
      setError(err instanceof Error ? err.message : 'Failed to update tags');
      pendingFetchRef.current = true;
      pendingFetchPreserveErrorRef.current = true;
      throw err;
    } finally {
      finishMutation();
    }
  };

  const handleDeleteTag = async (tag: string) => {
    const affected = todoItems.filter(item => item.categories?.includes(tag));
    await bulkUpdateCategories(
      affected,
      (item) => (item.categories || []).filter(c => c !== tag),
      () => setSelectedCategories(prev => { const next = new Set(prev); next.delete(tag); return next; }),
    );
  };

  const handleRenameTag = async (oldTag: string, newTag: string) => {
    const affected = todoItems.filter(item => item.categories?.includes(oldTag));
    await bulkUpdateCategories(
      affected,
      (item) => (item.categories || []).map(c => c === oldTag ? newTag : c),
      () => setSelectedCategories(prev => {
        if (!prev.has(oldTag)) return prev;
        const next = new Set(prev); next.delete(oldTag); next.add(newTag); return next;
      }),
    );
  };

  const handleMergeTag = async (sourceTag: string, targetTag: string) => {
    const affected = todoItems.filter(item => item.categories?.includes(sourceTag));
    await bulkUpdateCategories(
      affected,
      (item) => {
        const cats = item.categories || [];
        const without = cats.filter(c => c !== sourceTag);
        return without.includes(targetTag) ? without : [...without, targetTag];
      },
      () => setSelectedCategories(prev => {
        if (!prev.has(sourceTag)) return prev;
        const next = new Set(prev); next.delete(sourceTag); next.add(targetTag); return next;
      }),
    );
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
      await fetchEvents();
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
      fetchEvents();
    }
  }, [isAuthenticated, busy, bookId]);

  useRefreshOnPageActivation(
    () => void fetchEvents({
      preserveError: true,
      interaction: 'silent-only',
    }),
    isAuthenticated && !busy && !!bookId && !loading && !isSavingOrder,
  );

  // Push page actions into the shared top bar
  useSetTopBarActions(
    isAuthenticated && books.length > 1 ? (
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
    ) : (
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
    [isAuthenticated, busy, loading, isSavingOrder, bookId, books, allCategories, todoItems],
  );

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

  if (!isAuthenticated || authRecoveryRequired) {
    return (
      <div className={styles.container}>
        <div className={styles.inner}>
          <AuthRecoveryPanel
            busy={busy || (authRecoveryRequired && loading)}
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
            <div className={styles.matrixSection}>
              <div className={styles.matrixHeader}>
                <span className={styles.filterCount}>Showing {filteredTodoItems.length} of {todoItems.length} items</span>
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
