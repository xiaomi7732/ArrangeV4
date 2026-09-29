'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
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
import { isDateToday } from '@/lib/dateUtils';
import {
  moveBetweenContainers,
  nextOrder,
  normalizeOrder,
  reorderVisibleItems,
  replaceItems,
  sortByPersistedOrder,
} from '@/lib/orderUtils';
import { useAuthClient } from '@/lib/auth/useAuthClient';
import { isInteractiveAuthenticationRequiredError } from '@/lib/auth/errors';
import { useBookId } from '@/lib/hooks/useBookId';
import { useRefreshOnPageActivation } from '@/lib/hooks/useRefreshOnPageActivation';
import { useSetTopBarActions } from '@/components/TopBarProvider';
import AuthRecoveryPanel from '@/components/AuthRecoveryPanel';
import AddTodoItem from '@/components/AddTodoItem';
import ViewTodoItem from '@/components/ViewTodoItem';
import ManageTags from '@/components/ManageTags';
import ScrumCard from '@/components/ScrumCard';
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

const FILTER_MODES: StatusFilterMode[] = ['showAll', 'todayOnly', 'hide'];

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

function passesTodayFilter(todo: TodoItem): boolean {
  const status = todo.status || 'new';
  if (status === 'finished') return isDateToday(todo.finishDateTime);
  return isDateToday(todo.etsDateTime);
}

const LANE_STATUSES = ['new', 'blocked', 'inProgress', 'finished', 'cancelled'] as const satisfies readonly TodoStatus[];
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
  } = useBookId('/scrum');
  const bookIdRef = useRef(bookId);
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
  const [showTags, setShowTags] = useState(true);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [showUncategorized, setShowUncategorized] = useState(false);
  const [showManageTags, setShowManageTags] = useState(false);
  const [statusFilters, setStatusFilters] = useState<Record<TodoStatus, StatusFilterMode>>(DEFAULT_STATUS_FILTERS);
  const [showStatusFilters, setShowStatusFilters] = useState(false);
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

  const categoryFilterActive = selectedCategories.size > 0 || showUncategorized;

  const statusFilterActive = ALL_STATUSES.some(s => statusFilters[s] !== DEFAULT_STATUS_FILTERS[s]);

  const filteredItems = useMemo(() => {
    return todoItems.filter(todo => {
      const status = todo.status || 'new';
      if (!(LANE_STATUSES as readonly string[]).includes(status)) return false;

      const mode = statusFilters[status as LaneStatus];
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
  }, [todoItems, selectedCategories, showUncategorized, categoryFilterActive, statusFilters]);

  const visibleLanes = useMemo(() => {
    return LANE_STATUSES.filter(s => statusFilters[s] !== 'hide');
  }, [statusFilters]);

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
    if (!preserveError) setError(null);

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
      setTodoItems(items);
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
        const message = err instanceof Error ? err.message : 'Failed to fetch events';
        setError(message);
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
      const interaction = pendingFetchInteractionRef.current;
      pendingFetchRef.current = false;
      pendingFetchPreserveErrorRef.current = false;
      pendingFetchInteractionRef.current = 'allow-interactive';
      void fetchEvents({ preserveError, interaction });
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
      const message = err instanceof Error ? err.message : 'Failed to create TODO item';
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

  const statusTimestamps = (todo: TodoItemWithId, newStatus: TodoStatus): Partial<TodoItem> => {
    const currentStatus = todo.status || 'new';
    const now = new Date().toISOString();
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
    return updatedTimestamps;
  };

  const laneId = (status: TodoStatus) => `scrum:${status}`;
  const parseLaneId = (id: string) => id.slice('scrum:'.length) as LaneStatus;
  const itemsInLane = (status: LaneStatus) => canonicalLanes[status];

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
      console.error('Error updating Scrum order:', err);
      setError(err instanceof Error ? err.message : 'Failed to save Scrum order');
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
          <div className={styles.boardSection}>
            <div className={styles.boardHeader}>
              <span className={styles.filterCount}>
                Showing {filteredItems.length} of {todoItems.length} items
              </span>
              <div className={styles.boardHeaderActions}>
                <button
                  className={`${styles.button} ${styles.buttonSecondary} ${styles.filterToggle}`}
                  onClick={() => setShowStatusFilters(prev => !prev)}
                  aria-expanded={showStatusFilters}
                >
                  {showStatusFilters ? '▲' : '▼'} Status{statusFilterActive ? ' ●' : ''}
                </button>
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
              </div>
            </div>

            {showStatusFilters && (
              <div className={styles.filterBar}>
                {ALL_STATUSES.map(status => (
                  <div key={status} className={styles.filterGroup}>
                    <span className={`${styles.filterLabel} ${styles[`status_${status}`]}`}>{STATUS_LABELS[status]}</span>
                    <div className={styles.filterModes}>
                      {FILTER_MODES.map(mode => (
                        <button
                          key={mode}
                          type="button"
                          className={`${styles.filterMode} ${statusFilters[status] === mode ? styles.filterModeActive : ''}`}
                          aria-pressed={statusFilters[status] === mode}
                          onClick={() => setStatusFilters(prev => ({ ...prev, [status]: mode }))}
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
                    onClick={() => setStatusFilters(DEFAULT_STATUS_FILTERS)}
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
                        <p className={styles.laneEmpty}>No items</p>
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
