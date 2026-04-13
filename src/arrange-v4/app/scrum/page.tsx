'use client';

import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { getCalendarEvents } from '@/lib/graphService';
import { createTodoItem, updateTodoItem, TodoItem, parseTodoData, TodoStatus, STATUS_LABELS } from '@/lib/todoDataService';
import { getCalendarDisplayName } from '@/lib/calendarUtils';
import { useGraphToken } from '@/lib/hooks/useGraphToken';
import { useBookId } from '@/lib/hooks/useBookId';
import { useSetTopBarActions } from '@/components/TopBarProvider';
import AddTodoItem from '@/components/AddTodoItem';
import ViewTodoItem from '@/components/ViewTodoItem';
import ManageTags from '@/components/ManageTags';
import ScrumCard from '@/components/ScrumCard';
import Link from 'next/link';
import styles from './page.module.css';

const LANE_STATUSES = ['new', 'blocked', 'inProgress', 'finished'] as const satisfies readonly TodoStatus[];
type LaneStatus = (typeof LANE_STATUSES)[number];

const LANE_STYLES: Record<LaneStatus, { lane: string; title: string }> = {
  new: { lane: styles.laneNew, title: styles.laneTitleNew },
  inProgress: { lane: styles.laneInProgress, title: styles.laneTitleInProgress },
  blocked: { lane: styles.laneBlocked, title: styles.laneTitleBlocked },
  finished: { lane: styles.laneFinished, title: styles.laneTitleFinished },
};

function sortByPriority(items: (TodoItem & { id?: string })[]) {
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
  const { acquireToken, isAuthenticated, inProgress, handleLogin: graphLogin } = useGraphToken();
  const { bookId, calendars, currentCalendarName, handleCalendarSwitch, error: calendarError } = useBookId('/scrum');

  const [todoItems, setTodoItems] = useState<(TodoItem & { id?: string })[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draggedItem, setDraggedItem] = useState<(TodoItem & { id?: string }) | null>(null);
  const [selectedTodo, setSelectedTodo] = useState<(TodoItem & { id?: string }) | null>(null);
  const [showTags, setShowTags] = useState(true);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [showUncategorized, setShowUncategorized] = useState(false);
  const [showManageTags, setShowManageTags] = useState(false);

  const displayError = error || calendarError;

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

  const filteredItems = useMemo(() => {
    return todoItems.filter(todo => {
      const status = todo.status || 'new';
      if (!(LANE_STATUSES as readonly string[]).includes(status)) return false;

      if (categoryFilterActive) {
        const hasCats = todo.categories && todo.categories.length > 0;
        if (showUncategorized && !hasCats) return true;
        if (hasCats && todo.categories!.some(c => selectedCategories.has(c))) return true;
        return false;
      }
      return true;
    });
  }, [todoItems, selectedCategories, showUncategorized, categoryFilterActive]);

  const lanes = useMemo(() => {
    const result = {} as Record<LaneStatus, (TodoItem & { id?: string })[]>;
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
      const accessToken = await acquireToken();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const startDate = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      const endDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

      const eventsData = await getCalendarEvents(
        accessToken, bookId,
        startDate.toISOString(), endDate.toISOString()
      );
      setTodoItems(eventsData.map(event => parseTodoData(event)));
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

  const handleAddTodo = async (todoItem: TodoItem) => {
    if (!bookId) throw new Error('No book selected');
    try {
      const accessToken = await acquireToken();
      const createdEvent = await createTodoItem(accessToken, bookId, todoItem);
      const newTodo = parseTodoData(createdEvent);
      setTodoItems(prev => [...prev, newTodo]);
    } catch (err: unknown) {
      console.error('Error creating TODO item:', err);
      const message = err instanceof Error ? err.message : 'Failed to create TODO item';
      throw new Error(message);
    }
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
    [isAuthenticated, inProgress, loading, bookId, calendars, allCategories],
  );

  const handleDragStart = (todo: TodoItem & { id?: string }) => {
    setDraggedItem(todo);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (newStatus: TodoStatus) => {
    if (!draggedItem || !draggedItem.id || !bookId) return;

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
      const accessToken = await acquireToken();
      await updateTodoItem(accessToken, bookId, draggedItem.id, { status: newStatus });
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
      const accessToken = await acquireToken();
      await updateTodoItem(accessToken, bookId, selectedTodo.id, updatedFields);
    } catch (err: unknown) {
      console.error('Error updating TODO:', err);
      setTodoItems(previousItems);
      const reverted = previousItems.find(i => i.id === selectedTodo.id);
      if (reverted) setSelectedTodo(reverted);
      throw err;
    }
  };

  const bulkUpdateCategories = async (
    affectedItems: (TodoItem & { id?: string })[],
    computeNewCategories: (item: TodoItem & { id?: string }) => string[],
    updateFilterState: () => void,
  ) => {
    if (!bookId || affectedItems.length === 0) return;

    const previousItems = [...todoItems];
    const previousSelectedCategories = new Set(selectedCategories);
    const previousShowUncategorized = showUncategorized;
    const affectedIds = new Set(affectedItems.filter(a => a.id).map(a => a.id));

    setTodoItems(items =>
      items.map(item =>
        affectedIds.has(item.id)
          ? { ...item, categories: computeNewCategories(item) }
          : item
      )
    );
    updateFilterState();

    try {
      const accessToken = await acquireToken();
      const CONCURRENCY = 5;
      let idx = 0;
      const worker = async () => {
        while (idx < affectedItems.length) {
          const item = affectedItems[idx++];
          if (!item.id) continue;
          await updateTodoItem(accessToken, bookId, item.id, {
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
                {allCategories.length > 0 && (
                  <div className={styles.comboButton}>
                    <button
                      className={styles.comboButtonMain}
                      onClick={() => setShowTags(prev => !prev)}
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

            <div className={styles.board}>
              {LANE_STATUSES.map(status => {
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
