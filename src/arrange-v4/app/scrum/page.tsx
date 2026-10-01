'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef, useId, Suspense } from 'react';
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
import { describeFailure } from '@/lib/failureMessage';
import { bannerDerivesFrom, composeReconcileFailure } from '@/lib/reconcileMessage';
import { statusTimestampUpdates } from '@/lib/statusTimestamps';
import { useAuthClient } from '@/lib/auth/useAuthClient';
import { isInteractiveAuthenticationRequiredError } from '@/lib/auth/errors';
import { useBookId } from '@/lib/hooks/useBookId';
import { useRefreshOnPageActivation } from '@/lib/hooks/useRefreshOnPageActivation';
import { useDismissiblePanel } from '@/lib/hooks/useDismissiblePanel';
import { useSetTopBarActions } from '@/components/TopBarProvider';
import AuthRecoveryPanel from '@/components/AuthRecoveryPanel';
import ErrorBanner from '@/components/ErrorBanner';
import EmptyListMessage from '@/components/EmptyListMessage';
import AddTodoItem from '@/components/AddTodoItem';
import ViewTodoItem from '@/components/ViewTodoItem';
import ManageTags from '@/components/ManageTags';
import ScrumCard from '@/components/ScrumCard';
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

// Workflow order: a task moves New -> In Progress, drops into Blocked as an
// exception, and ends Finished. Ordering the lanes any other way makes the
// normal left-to-right progression skip a column and then go backwards.
const LANE_STATUSES = ['new', 'inProgress', 'blocked', 'finished', 'cancelled'] as const satisfies readonly TodoStatus[];
type LaneStatus = (typeof LANE_STATUSES)[number];

const LANE_STYLES: Record<LaneStatus, { lane: string; title: string }> = {
  new: { lane: styles.laneNew, title: styles.laneTitleNew },
  inProgress: { lane: styles.laneInProgress, title: styles.laneTitleInProgress },
  blocked: { lane: styles.laneBlocked, title: styles.laneTitleBlocked },
  finished: { lane: styles.laneFinished, title: styles.laneTitleFinished },
  cancelled: { lane: styles.laneCancelled, title: styles.laneTitleCancelled },
};

function comparePriority(a: TodoItemWithId, b: TodoItemWithId) {
  const ai = a.important ? 1 : 0;
  const bi = b.important ? 1 : 0;
  if (bi !== ai) return bi - ai;
  const au = a.urgent ? 1 : 0;
  const bu = b.urgent ? 1 : 0;
  if (bu !== au) return bu - au;
  return (a.subject || '').localeCompare(b.subject || '') || a.id.localeCompare(b.id);
}

function ScrumPageContent() {
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
  } = useBookId('/scrum');
  const bookIdRef = useRef(bookId);
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
  const [showTags, setShowTags] = useState(true);
  const [showManageTags, setShowManageTags] = useState(false);
  const taskQuery = useTaskQuery(bookId);
  const { query } = taskQuery;
  const [showStatusFilters, setShowStatusFilters] = useState(false);
  const statusPanelId = useId();
  const tagsPanelId = useId();
  const closeStatusPanel = useCallback(() => setShowStatusFilters(false), []);
  const closeTagsPanel = useCallback(() => setShowTags(false), []);
  const statusPanel = useDismissiblePanel<HTMLDivElement, HTMLButtonElement>(
    showStatusFilters,
    closeStatusPanel,
  );
  const tagsPanel = useDismissiblePanel<HTMLDivElement, HTMLButtonElement>(
    showTags,
    closeTagsPanel,
    // Open by default and in the page flow, so an outside click must not
    // collapse it out from under the user.
    { dismissOnOutsidePress: false },
  );
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableTodoKeyboardCoordinates }),
  );

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

  const statusFilterActive = isStatusFilterActive(query);

  const laneItems = useMemo(
    () => todoItems.filter(todo => (LANE_STATUSES as readonly string[]).includes(todo.status || 'new')),
    [todoItems],
  );

  // Deliberately not memoized: today-only filtering depends on the current
  // date, so results must refresh on re-render rather than stick across midnight.
  // One clock for both passes, so the count and the explanation of what is
  // hidden can never straddle midnight and disagree.
  const filterClock = new Date();
  const filteredItems = filterTasks(laneItems, query, { now: filterClock });
  const hiddenByStatus = summarizeHiddenByStatus(laneItems, query, filterClock);

  const visibleLanes = useMemo(() => {
    return LANE_STATUSES.filter(s => query.statusFilters[s] !== 'hide');
  }, [query.statusFilters]);

  const canonicalLanes = useMemo(() => {
    const result = {} as Record<LaneStatus, TodoItemWithId[]>;
    for (const status of LANE_STATUSES) {
      result[status] = sortByPersistedOrder(
        todoItems.filter(t => (t.status || 'new') === status),
        'scrumOrder',
        comparePriority,
      );
    }
    return result;
  }, [todoItems]);

  const visibleItemIds = useMemo(
    () => new Set(filteredItems.map(item => item.id)),
    [filteredItems],
  );

  const lanes = useMemo(() => {
    const result = {} as Record<LaneStatus, TodoItemWithId[]>;
    for (const status of LANE_STATUSES) {
      result[status] = canonicalLanes[status].filter(item => visibleItemIds.has(item.id));
    }
    return result;
  }, [canonicalLanes, visibleItemIds]);

  const fetchEvents = useCallback(async ({
    preserveError = false,
    interaction = 'allow-interactive',
  }: FetchEventsOptions = {}) => {
    const requestedBookId = bookIdRef.current;
    if (!isAuthenticated || !requestedBookId) return;
    if (isSavingOrderRef.current || pendingMutationCountRef.current > 0) {
      if (!pendingFetchRef.current) {
        pendingFetchInteractionRef.current = interaction;
      } else if (interaction === 'allow-interactive') {
        pendingFetchInteractionRef.current = 'allow-interactive';
      }
      pendingFetchRef.current = true;
      pendingFetchPreserveErrorRef.current ||= preserveError;
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
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const startDate = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      const endDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

      const items = await store.listItems(requestedBookId, {
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
          if (!pendingFetchRef.current) {
            pendingFetchInteractionRef.current = interaction;
          } else if (interaction === 'allow-interactive') {
            pendingFetchInteractionRef.current = 'allow-interactive';
          }
          pendingFetchRef.current = true;
          pendingFetchPreserveErrorRef.current ||= preserveError;
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
      setTodoItems(items);
      if (unverifiedWriteRef.current) {
        // This read is authoritative, so the board is no longer a guess. The
        // write failure itself stays: the user still needs to know it failed.
        setError(unverifiedWriteRef.current.message);
        unverifiedWriteRef.current = null;
      }
      setItemsBookId(requestedBookId);
      setAuthRecoveryRequired(false);
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
  }, [isAuthenticated, store]);

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
  }, [isAuthenticated, busy, bookId, fetchEvents]);

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

  const handleAddTodo = async (todoItem: TodoItem) => {
    if (!bookId) throw new Error('No book selected');
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
        <AddTodoItem
          onAddTodo={handleAddTodo}
          disabled={loading}
          defaultUrgent
          defaultImportant
          availableCategories={allCategories}
        />
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

  const statusTimestamps = (todo: TodoItemWithId, newStatus: TodoStatus): Partial<TodoItem> =>
    statusTimestampUpdates(todo, newStatus, new Date().toISOString());

  const laneId = (status: TodoStatus) => `scrum:${status}`;
  const parseLaneId = (id: string) => id.slice('scrum:'.length) as LaneStatus;
  const itemsInLane = (status: LaneStatus) => canonicalLanes[status];

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

    const sourceStatus = parseLaneId(sourceId);
    const destinationStatus = parseLaneId(destinationId);
    const sourceItems = itemsInLane(sourceStatus);
    const destinationItems = sourceId === destinationId
      ? sourceItems
      : itemsInLane(destinationStatus);

    let replacements: TodoItemWithId[];
    const updates = new Map<string, Partial<TodoItem>>();

    if (sourceId === destinationId) {
      const visibleItems = lanes[sourceStatus];
      const visibleIds = new Set(visibleItems.map(item => item.id));
      const targetId = visibleIds.has(overId) ? overId : visibleItems.at(-1)?.id;
      if (!targetId) return;
      const reordered = reorderVisibleItems(sourceItems, visibleIds, activeId, targetId);
      const normalized = normalizeOrder(reordered, 'scrumOrder');
      replacements = normalized.items;
      for (const item of normalized.changed) {
        updates.set(item.id, { scrumOrder: item.scrumOrder });
      }
    } else {
      const activeItem = todoItems.find(item => item.id === activeId);
      if (!activeItem) return;
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
      const timestamps = statusTimestamps(activeItem, destinationStatus);
      const movedDestination = moved.destination.map(item => item.id === activeId
        ? { ...item, status: destinationStatus, ...timestamps }
        : item
      );
      const normalizedSource = normalizeOrder(moved.source, 'scrumOrder');
      const normalizedDestination = normalizeOrder(movedDestination, 'scrumOrder');
      replacements = [...normalizedSource.items, ...normalizedDestination.items];
      for (const item of [...normalizedSource.changed, ...normalizedDestination.changed]) {
        updates.set(item.id, { scrumOrder: item.scrumOrder });
      }
      updates.set(activeId, {
        ...updates.get(activeId),
        status: destinationStatus,
        ...timestamps,
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
      console.error('Error updating Scrum order:', err);
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
          <div className={styles.boardSection}>
            <TaskSearchBar
              query={query}
              queryActive={taskQuery.queryActive}
              resultCount={filteredItems.length}
              totalCount={laneItems.length}
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
            <div className={styles.boardHeader}>
              <span className={styles.filterCount} />
              <div className={styles.boardHeaderActions}>
                <button
                  ref={statusPanel.triggerRef}
                  className={`${styles.button} ${styles.buttonSecondary} ${styles.filterToggle}`}
                  onClick={() => setShowStatusFilters(prev => !prev)}
                  aria-expanded={showStatusFilters}
                  aria-haspopup="true"
                  aria-controls={statusPanelId}
                >
                  {showStatusFilters ? '▲' : '▼'} Status{statusFilterActive ? ' ●' : ''}
                </button>
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
              </div>
            </div>

            {showStatusFilters && (
              <div className={styles.filterBar} id={statusPanelId} ref={statusPanel.panelRef}>
                {ALL_STATUSES.map(status => (
                  <div key={status} className={styles.filterGroup}>
                    <span className={`${styles.filterLabel} ${styles[`status_${status}`]}`}>{STATUS_LABELS[status]}</span>
                    <div className={styles.filterModes}>
                      {FILTER_MODES.map(mode => (
                        <button
                          key={mode}
                          type="button"
                          className={`${styles.filterMode} ${query.statusFilters[status] === mode ? styles.filterModeActive : ''}`}
                          aria-pressed={query.statusFilters[status] === mode}
                          onClick={() => taskQuery.setStatusFilter(status, mode)}
                        >
                          {FILTER_MODE_LABELS[mode]}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {statusFilterActive && (
                  <button
                    className={`${styles.categoryFilterChip} ${styles.categoryFilterClear}`}
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
            <div
              className={styles.board}
              style={{ '--lane-columns': `repeat(${visibleLanes.length || 1}, 1fr)` } as React.CSSProperties}
            >
              {visibleLanes.map(status => {
                const items = lanes[status] || [];
                const laneStyle = LANE_STYLES[status];
                return (
                  <div
                    key={status}
                    className={`${styles.lane} ${laneStyle.lane}`}
                  >
                    <div className={styles.laneHeader}>
                      <h3 className={`${styles.laneTitle} ${laneStyle.title}`}>
                        {STATUS_LABELS[status]}
                      </h3>
                      <span className={styles.laneCount}>{items.length}</span>
                    </div>
                    <SortableTodoList
                      id={laneId(status)}
                      itemIds={items.map(todo => todo.id)}
                      className={styles.laneContent}
                    >
                      {items.map(todo => (
                        <SortableTodo key={todo.id} id={todo.id} containerId={laneId(status)} disabled={isSavingOrder}>
                          <ScrumCard
                            todo={todo}
                            onClick={isSavingOrder ? undefined : setSelectedTodo}
                          />
                        </SortableTodo>
                      ))}
                      {items.length === 0 && (
                        <EmptyListMessage
                          filtered={taskQuery.queryActive}
                          onClearFilters={taskQuery.clearAll}
                          className={styles.laneEmpty}
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
                  <ScrumCard todo={draggedItem} />
                </SortableTodoOverlay>
              ) : null}
            </DragOverlay>
            </DndContext>
          </div>
        )}

        {selectedTodo && (
          <ViewTodoItem
            todo={selectedTodo}
            onClose={() => setSelectedTodo(null)}
            onUpdate={handleUpdateTodo}
            availableCategories={allCategories}
          />
        )}

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

export default function ScrumPage() {
  return (
    <Suspense fallback={
      <div className={styles.container}>
        <div className={styles.inner}>
          <div className={styles.loading}><div className={styles.spinner}></div></div>
        </div>
      </div>
    }>
      <ScrumPageContent />
    </Suspense>
  );
}
