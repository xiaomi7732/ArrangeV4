'use client';

import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useStore } from '@/lib/store/useStore';
import { TodoItem, TodoItemWithId, TodoStatus, ALL_STATUSES, STATUS_LABELS } from '@/lib/store/types';
import { useAuthClient } from '@/lib/auth/useAuthClient';
import { useBookId } from '@/lib/hooks/useBookId';
import { useSetTopBarActions } from '@/components/TopBarProvider';
import AddTodoItem from '@/components/AddTodoItem';
import ViewTodoItem from '@/components/ViewTodoItem';
import ManageTags from '@/components/ManageTags';
import ScrumCard from '@/components/ScrumCard';
import Link from 'next/link';
import styles from './page.module.css';

type StatusFilterMode = 'showAll' | 'todayOnly' | 'hide';

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

const LANE_STATUSES = ['new', 'blocked', 'inProgress', 'finished', 'cancelled'] as const satisfies readonly TodoStatus[];
type LaneStatus = (typeof LANE_STATUSES)[number];

const LANE_STYLES: Record<LaneStatus, { lane: string; title: string }> = {
  new: { lane: styles.laneNew, title: styles.laneTitleNew },
  inProgress: { lane: styles.laneInProgress, title: styles.laneTitleInProgress },
  blocked: { lane: styles.laneBlocked, title: styles.laneTitleBlocked },
  finished: { lane: styles.laneFinished, title: styles.laneTitleFinished },
  cancelled: { lane: styles.laneCancelled, title: styles.laneTitleCancelled },
};

function sortByPriority(items: TodoItemWithId[]) {
  return [...items].sort((a, b) => {
    const ai = a.important ? 1 : 0;
    const bi = b.important ? 1 : 0;
    if (bi !== ai) return bi - ai;
    const au = a.urgent ? 1 : 0;
    const bu = b.urgent ? 1 : 0;
    if (bu !== au) return bu - au;
    return (a.subject || '').localeCompare(b.subject || '');
  });
}

function ScrumPageContent() {
  const auth = useAuthClient();
  const { isAuthenticated, busy } = auth;
  const store = useStore();
  const { bookId, books, handleBookSwitch, error: bookError } = useBookId('/scrum');

  const [todoItems, setTodoItems] = useState<TodoItemWithId[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draggedItem, setDraggedItem] = useState<TodoItemWithId | null>(null);
  const [selectedTodo, setSelectedTodo] = useState<TodoItemWithId | null>(null);
  const [showTags, setShowTags] = useState(true);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [showUncategorized, setShowUncategorized] = useState(false);
  const [showManageTags, setShowManageTags] = useState(false);
  const [statusFilters, setStatusFilters] = useState<Record<TodoStatus, StatusFilterMode>>(DEFAULT_STATUS_FILTERS);
  const [showStatusFilters, setShowStatusFilters] = useState(false);

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

  const lanes = useMemo(() => {
    const result = {} as Record<LaneStatus, TodoItemWithId[]>;
    for (const status of LANE_STATUSES) {
      result[status] = sortByPriority(filteredItems.filter(t => (t.status || 'new') === status));
    }
    return result;
  }, [filteredItems]);

  const fetchEvents = useCallback(async () => {
    if (!isAuthenticated || !bookId) return;

    setLoading(true);
    setError(null);

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const startDate = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      const endDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

      const items = await store.listItems(bookId, {
        range: 'window',
        fromDate: startDate.toISOString(),
        toDate: endDate.toISOString(),
      });
      setTodoItems(items);
    } catch (err: unknown) {
      console.error('Error fetching events:', err);
      const message = err instanceof Error ? err.message : 'Failed to fetch events';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, bookId, store]);

  useEffect(() => {
    if (isAuthenticated && !busy && bookId) {
      fetchEvents();
    }
  }, [isAuthenticated, busy, bookId, fetchEvents]);

  const handleAddTodo = async (todoItem: TodoItem) => {
    if (!bookId) throw new Error('No book selected');
    try {
      const newTodo = await store.createItem(bookId, todoItem);
      setTodoItems(prev => [...prev, newTodo]);
    } catch (err: unknown) {
      console.error('Error creating TODO item:', err);
      const message = err instanceof Error ? err.message : 'Failed to create TODO item';
      throw new Error(message);
    }
  };

  const handleLogin = async () => {
    try {
      await auth.login();
    } catch (err) {
      console.error('Login failed:', err);
      setError('Login failed. Please try again.');
    }
  };

  useSetTopBarActions(
    books.length > 1 ? (
      <select
        className={styles.bookSwitcher}
        value={bookId || ''}
        onChange={(e) => handleBookSwitch(e.target.value)}
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
          onClick={fetchEvents}
          disabled={loading}
          className={`${styles.button} ${styles.buttonSecondary}`}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </>
    ),
    [isAuthenticated, busy, loading, bookId, books, allCategories],
  );

  const handleDragStart = (todo: TodoItemWithId) => {
    setDraggedItem(todo);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (newStatus: TodoStatus) => {
    if (!draggedItem || !bookId) return;

    const currentStatus = draggedItem.status || 'new';
    if (currentStatus === newStatus) {
      setDraggedItem(null);
      return;
    }

    const now = new Date().toISOString();
    const updatedTimestamps: Partial<TodoItem> = {};

    if (newStatus === 'inProgress' && !draggedItem.startDateTime) {
      updatedTimestamps.startDateTime = now;
    }
    if (newStatus === 'new') {
      updatedTimestamps.startDateTime = undefined;
    }
    if (newStatus === 'finished') {
      if (!draggedItem.startDateTime) updatedTimestamps.startDateTime = now;
      if (!draggedItem.finishDateTime) updatedTimestamps.finishDateTime = now;
    }
    if (newStatus !== 'finished' && currentStatus === 'finished') {
      updatedTimestamps.finishDateTime = undefined;
    }

    const previousItems = [...todoItems];
    setTodoItems(items =>
      items.map(item =>
        item.id === draggedItem.id
          ? { ...item, status: newStatus, ...updatedTimestamps }
          : item
      )
    );
    setDraggedItem(null);

    try {
      await store.updateItem(bookId, draggedItem.id, { status: newStatus });
    } catch (err: unknown) {
      console.error('Error updating TODO status:', err);
      setTodoItems(previousItems);
      setError(err instanceof Error ? err.message : 'Failed to update status');
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
      await store.updateItem(bookId, selectedTodo.id, updatedFields);
    } catch (err: unknown) {
      console.error('Error updating TODO:', err);
      setTodoItems(previousItems);
      const reverted = previousItems.find(i => i.id === selectedTodo.id);
      if (reverted) setSelectedTodo(reverted);
      throw err;
    }
  };

  const bulkUpdateCategories = async (
    affectedItems: TodoItemWithId[],
    computeNewCategories: (item: TodoItemWithId) => string[],
    updateFilterState: () => void,
  ) => {
    if (!bookId || affectedItems.length === 0) return;

    const previousItems = [...todoItems];
    const previousSelectedCategories = new Set(selectedCategories);
    const previousShowUncategorized = showUncategorized;
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
          await store.updateItem(bookId, item.id, {
            categories: computeNewCategories(item),
          });
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, affectedItems.length) }, () => worker()));
    } catch (err: unknown) {
      console.error('Error updating tags:', err);
      setTodoItems(previousItems);
      setSelectedCategories(previousSelectedCategories);
      setShowUncategorized(previousShowUncategorized);
      throw err;
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
                    className={`${styles.lane} ${laneStyle.lane} ${draggedItem ? styles.laneDropZone : ''}`}
                    onDragOver={handleDragOver}
                    onDrop={() => handleDrop(status)}
                  >
                    <div className={styles.laneHeader}>
                      <h3 className={`${styles.laneTitle} ${laneStyle.title}`}>
                        {STATUS_LABELS[status]}
                      </h3>
                      <span className={styles.laneCount}>{items.length}</span>
                    </div>
                    <div className={styles.laneContent}>
                      {items.map(todo => (
                        <ScrumCard
                          key={todo.id}
                          todo={todo}
                          onDragStart={handleDragStart}
                          onDragEnd={() => setDraggedItem(null)}
                          onClick={setSelectedTodo}
                        />
                      ))}
                      {items.length === 0 && (
                        <p className={styles.laneEmpty}>No items</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
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
