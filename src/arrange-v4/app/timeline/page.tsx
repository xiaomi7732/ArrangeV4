'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useStore } from '@/lib/store/useStore';
import type { StoreOperationOptions, TodoItem, TodoItemWithId } from '@/lib/store/types';
import { filterTasks } from '@/lib/search/taskQuery';
import { describeFailure } from '@/lib/failureMessage';
import { restoreSnapshot, snapshotItems } from '@/lib/optimisticUpdate';
import { statusTimestampUpdates } from '@/lib/statusTimestamps';
import { bannerDerivesFrom, composeReconcileFailure } from '@/lib/reconcileMessage';
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
import TimelineChart, { PAN_STEP, ZOOM_STEP } from '@/components/TimelineChart';
import {
  type TimelineWindow,
  centerWindowOn,
  defaultWindow,
  describeWindow,
  fetchRangeFor,
  panWindow,
  zoomWindow,
} from '@/lib/timeline/timelineWindow';
import { countTimelineRows } from '@/lib/timeline/timelineRows';
import styles from './page.module.css';

type FetchEventsOptions = StoreOperationOptions & { preserveError?: boolean };

interface LoadedRange {
  bookId: string;
  startMs: number;
  endMs: number;
}

/** How long the window must sit still before a read outside it is worth making. */
const WINDOW_FETCH_DEBOUNCE_MS = 250;

function covers(range: LoadedRange | null, bookId: string, window: TimelineWindow): boolean {
  return !!range
    && range.bookId === bookId
    && range.startMs <= window.startMs
    && range.endMs >= window.endMs;
}

function TimelinePageContent() {
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
  } = useBookId('/timeline');

  const [items, setItems] = useState<TodoItemWithId[]>([]);
  const [itemsBookId, setItemsBookId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authRecoveryRequired, setAuthRecoveryRequired] = useState(false);
  const [selectedTodo, setSelectedTodo] = useState<(TodoItem & { id?: string }) | null>(null);
  const [timelineWindow, setTimelineWindow] = useState<TimelineWindow>(() => defaultWindow());

  // The "now" marker is read once per load rather than on every render, so the
  // chart does not re-render on a clock tick it cannot show anyway.
  const [nowMs, setNowMs] = useState(() => Date.now());

  const dismissedFetchSequenceRef = useRef(0);
  const bookIdRef = useRef(bookId);
  const fetchSequenceRef = useRef(0);
  // The range the loaded items cover. A pan or zoom inside it needs no refetch,
  // which is what makes dragging the window feel immediate. It is state rather
  // than a ref because a late reply for some other window can shrink it, and
  // the coverage check has to run again when that happens.
  const [loadedRange, setLoadedRange] = useState<LoadedRange | null>(null);
  // The range a request already in flight will cover. Without it, every frame
  // of a drag past the edge would start another identical read.
  const pendingRangeRef = useRef<LoadedRange | null>(null);
  // Counts local edits. A read that started before one must not commit: its
  // reply predates the edit and would put the old row back on screen.
  const mutationVersionRef = useRef(0);
  const pendingMutationCountRef = useRef(0);
  // A read discarded for that reason is replayed once the writes settle,
  // otherwise the window would stay on whatever was loaded before.
  const pendingReplayRef = useRef<{ preserveError: boolean } | null>(null);
  const fetchEventsRef = useRef<((
    window: TimelineWindow,
    options?: FetchEventsOptions,
  ) => Promise<void>) | null>(null);

  const flushPendingReplay = useCallback(() => {
    if (pendingMutationCountRef.current > 0) return;
    const pending = pendingReplayRef.current;
    if (!pending) return;
    pendingReplayRef.current = null;
    void fetchEventsRef.current?.(timelineWindowRef.current, {
      preserveError: pending.preserveError,
      interaction: 'silent-only',
    });
  }, []);

  bookIdRef.current = bookId;

  // The top bar and the activation refresh need the current window, but must
  // not be rebuilt on every frame of a drag.
  const timelineWindowRef = useRef(timelineWindow);
  useEffect(() => {
    timelineWindowRef.current = timelineWindow;
  }, [timelineWindow]);

  const displayError = error || bookError;
  const requiresAuthRecovery = authRecoveryRequired || bookAuthRecoveryRequired;

  // Search only: the chart has no room for tag or priority controls, so its
  // presets are kept in their own scope rather than silently stripping criteria
  // from a board preset of the same name.
  const taskQuery = useTaskQuery(bookId, { presetScope: 'timeline' });
  const { query } = taskQuery;

  const visibleItems = useMemo(
    () => filterTasks(items, query, { applyStatusFilters: false }),
    [items, query],
  );

  /*
   * The counts report bars, not loaded items: the read deliberately covers
   * more than the window, and a task with no dates is never drawn, so counting
   * items would promise tasks the user cannot see.
   */
  const drawnCount = useMemo(
    () => countTimelineRows(visibleItems, timelineWindow),
    [visibleItems, timelineWindow],
  );
  const inWindowCount = useMemo(
    () => countTimelineRows(items, timelineWindow),
    [items, timelineWindow],
  );

  // The tags already in use in this book, offered when editing a task.
  const availableCategories = useMemo(() => {
    const names = new Set<string>();
    for (const item of items) {
      for (const category of item.categories || []) names.add(category);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const fetchEvents = useCallback(async (
    window: TimelineWindow,
    { preserveError = false, interaction = 'allow-interactive' }: FetchEventsOptions = {},
  ) => {
    const requestedBookId = bookIdRef.current;
    if (!isAuthenticated || !requestedBookId) return;
    const fetchSequence = ++fetchSequenceRef.current;
    const requestedMutationVersion = mutationVersionRef.current;
    const range = fetchRangeFor(window);
    pendingRangeRef.current = { bookId: requestedBookId, ...range };

    setLoading(true);
    if (!preserveError) setError(null);

    try {
      const loaded = await store.listItems(requestedBookId, {
        range: 'window',
        fromDate: new Date(range.startMs).toISOString(),
        toDate: new Date(range.endMs).toISOString(),
        interaction,
      });
      if (
        fetchSequenceRef.current !== fetchSequence ||
        bookIdRef.current !== requestedBookId
      ) return;
      if (mutationVersionRef.current !== requestedMutationVersion) {
        // The reply predates a local edit, so committing it would undo the
        // edit on screen. Read again once the writes are done.
        pendingReplayRef.current = {
          preserveError: preserveError || pendingReplayRef.current?.preserveError === true,
        };
        flushPendingReplay();
        return;
      }
      setItems(loaded);
      setItemsBookId(requestedBookId);
      setNowMs(Date.now());
      setLoadedRange({ bookId: requestedBookId, ...range });
      setAuthRecoveryRequired(false);
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
        setError(null);
        return;
      }
      console.error('Error fetching timeline items:', err);
      const message = describeFailure('Could not load the timeline.', err);
      if (fetchSequence <= dismissedFetchSequenceRef.current) {
        // This read was already running when the user dismissed the banner.
        // Reporting it now would reopen something they closed.
        return;
      }
      setError(previous => (
        bannerDerivesFrom(previous, message, 'list')
          ? previous
          : composeReconcileFailure(null, message, 'list')
      ));
    } finally {
      if (pendingRangeRef.current?.startMs === range.startMs
        && pendingRangeRef.current?.endMs === range.endMs
        && pendingRangeRef.current?.bookId === requestedBookId) {
        pendingRangeRef.current = null;
      }
      if (
        fetchSequenceRef.current === fetchSequence &&
        bookIdRef.current === requestedBookId
      ) {
        setLoading(false);
      }
    }
  }, [isAuthenticated, store, flushPendingReplay]);

  useEffect(() => {
    fetchEventsRef.current = fetchEvents;
  }, [fetchEvents]);

  useEffect(() => {
    if (bookId && bookId !== itemsBookId) {
      setLoading(isAuthenticated && !busy);
      setItems([]);
      setSelectedTodo(null);
      setLoadedRange(null);
      pendingRangeRef.current = null;
    }
  }, [bookId, itemsBookId, isAuthenticated, busy]);

  /*
   * Loads whenever the window moves outside what is already in hand, or
   * outside what a read already under way will bring. Panning and zooming
   * within the loaded range redraws from memory, so the chart keeps up with a
   * drag instead of firing a request per frame; the short wait covers the rest
   * of the drag, when the window moves faster than the network can answer.
   */
  useEffect(() => {
    if (!isAuthenticated || busy || !bookId) return;
    if (covers(loadedRange, bookId, timelineWindow)) return;
    if (covers(pendingRangeRef.current, bookId, timelineWindow)) return;
    const timer = setTimeout(() => {
      void fetchEvents(timelineWindow, { interaction: 'silent-only' });
    }, WINDOW_FETCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [isAuthenticated, busy, bookId, timelineWindow, loadedRange, fetchEvents]);

  useRefreshOnPageActivation(
    () => void fetchEvents(timelineWindowRef.current, {
      preserveError: true,
      interaction: 'silent-only',
    }),
    isAuthenticated && !requiresAuthRecovery && !busy && !!bookId && !loading,
  );

  const handleLogin = useCallback(async () => {
    setError(null);
    try {
      await auth.login();
    } catch (err) {
      console.error('Login failed:', err);
      setError('Login failed. Please try again.');
    }
  }, [auth]);

  const handleAuthRecovery = async () => {
    if (isAuthenticated) {
      let booksRecovered = true;
      if (bookAuthRecoveryRequired) {
        booksRecovered = await fetchBooks({ interaction: 'allow-interactive' });
      }
      if (booksRecovered && authRecoveryRequired) {
        await fetchEvents(timelineWindow);
      }
      return;
    }
    await handleLogin();
  };

  /*
   * Editing from the chart.
   *
   * Both the dialog and a dragged bar end up here: they are the same write,
   * and keeping one path means a drag inherits the optimistic patch, the
   * rollback, and the guard against a read that started before the edit.
   */
  const applyUpdate = async (
    target: (TodoItem & { id?: string }) | null,
    updatedFields: Partial<TodoItem>,
  ) => {
    if (!target?.id || !bookId) return;
    const operationBookId = bookId;
    const targetId = target.id;
    const snapshot = snapshotItems(items, [targetId]);

    const persistedFields: Partial<TodoItem> = { ...updatedFields };
    const nextStatus = updatedFields.status ?? target.status ?? 'new';
    if (nextStatus !== (target.status || 'new')) {
      // The stores derive these from the transition too, but only the caller
      // can keep the item on screen in step with them.
      Object.assign(
        persistedFields,
        statusTimestampUpdates(target, nextStatus, new Date().toISOString()),
      );
    }

    // The stores drop the pre-bump original for a date the caller sets, so the
    // "moved" notice has to go with the same edit rather than wait for a read.
    const optimisticFields: Partial<TodoItem> = { ...persistedFields };
    if (updatedFields.etsDateTime !== undefined) optimisticFields.originalEtsDateTime = null;
    if (updatedFields.etaDateTime !== undefined) optimisticFields.originalEtaDateTime = null;

    setItems(current => current.map(item => (
      item.id === targetId ? { ...item, ...optimisticFields } : item
    )));
    setSelectedTodo(previous => (
      previous && previous.id === targetId ? { ...previous, ...optimisticFields } : previous
    ));
    // Anything already in flight now holds a pre-edit copy of this row.
    mutationVersionRef.current += 1;
    pendingMutationCountRef.current += 1;

    try {
      const updated = await store.updateItem(operationBookId, targetId, persistedFields);
      if (bookIdRef.current !== operationBookId) return;
      setItems(current => current.map(item => (
        item.id === targetId ? { ...item, source: updated.source ?? item.source } : item
      )));
    } catch (err: unknown) {
      console.error('Error updating TODO:', err);
      if (bookIdRef.current !== operationBookId) return;
      setItems(current => restoreSnapshot(current, snapshot));
      setSelectedTodo(previous => (previous && previous.id === targetId ? null : previous));
      const writeMessage = describeFailure('Could not save your changes.', err);
      setError(writeMessage);
      // The restored row is a guess until a read confirms it, so a read is
      // queued below, and it keeps the banner rather than quietly replacing it.
      pendingReplayRef.current = { preserveError: true };
      throw err;
    } finally {
      pendingMutationCountRef.current -= 1;
      flushPendingReplay();
    }
  };

  // The dialog reports a failed save to the user itself, so the rejection is
  // left to propagate here.
  const handleUpdateTodo = (updatedFields: Partial<TodoItem>) =>
    applyUpdate(selectedTodo, updatedFields);

  /*
   * A bar dragged by one of its ends. Nothing is listening for a rejection
   * here — the error banner and the rollback have already happened — so it is
   * swallowed rather than left as an unhandled rejection.
   */
  const handleRescheduleItem = (
    item: TodoItemWithId,
    next: { etsDateTime?: string; etaDateTime?: string },
  ) => {
    void applyUpdate(item, next).catch(() => {});
  };

  const goToToday = useCallback(() => {
    const now = Date.now();
    setNowMs(now);
    setTimelineWindow(current => centerWindowOn(current, now));
  }, []);

  useSetTopBarActions(
    isAuthenticated && !requiresAuthRecovery && books.length > 1 ? (
      <select
        className={styles.bookSwitcher}
        value={bookId || ''}
        onChange={(e) => handleBookSwitch(e.target.value)}
        disabled={loading}
      >
        {books.map(b => (
          <option key={b.id} value={b.id}>{b.name}</option>
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
      <button
        onClick={() => void fetchEvents(timelineWindowRef.current)}
        disabled={loading}
        className={`${styles.button} ${styles.buttonSecondary}`}
      >
        {loading ? 'Loading...' : 'Refresh'}
      </button>
    ),
    [isAuthenticated, requiresAuthRecovery, busy, loading, bookId, books,
      handleBookSwitch, handleLogin, fetchEvents],
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
              dismissedFetchSequenceRef.current = fetchSequenceRef.current;
              setError(null);
              setBookError(null);
            }}
          />
        )}

        <div className={styles.card}>
          <TaskSearchBar
            query={query}
            queryActive={taskQuery.queryActive}
            resultCount={drawnCount}
            totalCount={inWindowCount}
            scopeNote="counts tasks drawn in the visible period"
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
          />

          <div className={styles.toolbar}>
            <span className={styles.rangeLabel}>{describeWindow(timelineWindow)}</span>
            <div className={styles.toolbarButtons}>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => setTimelineWindow(w => panWindow(w, -PAN_STEP))}
                aria-label="Move the window earlier"
                title="Earlier"
              >
                ‹
              </button>
              <button
                type="button"
                className={styles.iconButton}
                onClick={goToToday}
              >
                Today
              </button>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => setTimelineWindow(w => panWindow(w, PAN_STEP))}
                aria-label="Move the window later"
                title="Later"
              >
                ›
              </button>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => setTimelineWindow(w => zoomWindow(w, 1 / ZOOM_STEP))}
                aria-label="Zoom in"
                title="Zoom in"
              >
                +
              </button>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => setTimelineWindow(w => zoomWindow(w, ZOOM_STEP))}
                aria-label="Zoom out"
                title="Zoom out"
              >
                −
              </button>
            </div>
          </div>

          {loading && itemsBookId !== bookId ? (
            <div className={styles.loading}><div className={styles.spinner}></div></div>
          ) : (
            <TimelineChart
              /*
               * A new book gets a new chart: an unsaved keyboard nudge is
               * flushed by the instance that started it, so it can never be
               * written against the book the user has just switched to.
               */
              key={bookId ?? 'no-book'}
              items={visibleItems}
              window={timelineWindow}
              onWindowChange={setTimelineWindow}
              onSelectItem={setSelectedTodo}
              onRescheduleItem={handleRescheduleItem}
              nowMs={nowMs}
              emptyMessage={
                loading
                  ? 'Loading tasks for this period…'
                  : inWindowCount === 0
                  ? 'No tasks fall in this period. Try moving or widening the window.'
                  : 'No task matches the current search in this period.'
              }
            />
          )}

          <p className={styles.hint}>
            Drag or shift-scroll to move through time, and ctrl-scroll or pinch to zoom.
            Select a bar to open the task, or drag either end of it to change the
            estimated start or finish.
          </p>
        </div>

        {selectedTodo && (
          <ViewTodoItem
            todo={selectedTodo}
            onClose={() => setSelectedTodo(null)}
            onUpdate={handleUpdateTodo}
            availableCategories={availableCategories}
          />
        )}
      </div>
    </div>
  );
}

export default function TimelinePage() {
  return (
    <Suspense fallback={
      <div className={styles.container}>
        <div className={styles.inner}>
          <div className={styles.loading}><div className={styles.spinner}></div></div>
        </div>
      </div>
    }>
      <TimelinePageContent />
    </Suspense>
  );
}
