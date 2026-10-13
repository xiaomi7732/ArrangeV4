'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';

/**
 * Tracks how many writes are in flight, so a view can say so.
 *
 * Every board writes optimistically: the card moves at once and the backend
 * catches up afterwards. That is right for a single drag, but it leaves a user
 * who moves several tasks in a row with nothing to tell them the queue is
 * still draining — so they keep dragging, and a slow connection quietly piles
 * up work whose failures all arrive at once.
 *
 * Nothing here blocks: the indicator reports the queue, it does not gate it.
 */

/** A fast save must not flash a spinner, so the reveal is delayed this long. */
export const SAVING_VISIBLE_AFTER_MS = 400;

export interface PendingMutationsState {
  count: number;
  /** True once the reveal delay has elapsed with writes still outstanding. */
  saving: boolean;
}

export type PendingMutationsAction =
  | { type: 'begin' }
  | { type: 'end' }
  /** The reveal delay elapsed; whether it shows still depends on the count. */
  | { type: 'reveal' };

export const initialPendingMutationsState: PendingMutationsState = {
  count: 0,
  saving: false,
};

export function pendingMutationsReducer(
  state: PendingMutationsState,
  action: PendingMutationsAction,
): PendingMutationsState {
  switch (action.type) {
    case 'begin':
      return { count: state.count + 1, saving: state.saving };
    case 'end': {
      // Clamped so a stray extra `end` can never drive the count negative and
      // leave a later `begin` looking like it has nothing outstanding.
      const count = Math.max(0, state.count - 1);
      return { count, saving: count === 0 ? false : state.saving };
    }
    case 'reveal':
      // Re-checked here because the write may have landed while the timer ran,
      // and announcing "Saving…" for something already saved is a lie.
      return state.count > 0 ? { count: state.count, saving: true } : state;
  }
}

export interface PendingMutations {
  /**
   * The live count, for handlers that read it synchronously while deciding
   * whether to defer a refetch — they run before React has re-rendered.
   */
  countRef: React.RefObject<number>;
  saving: boolean;
  begin: () => void;
  end: () => void;
}

export function usePendingMutations(
  visibleAfterMs: number = SAVING_VISIBLE_AFTER_MS,
): PendingMutations {
  const [state, dispatch] = useReducer(pendingMutationsReducer, initialPendingMutationsState);
  const countRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealedRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const armTimer = useCallback(() => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (countRef.current > 0) revealedRef.current = true;
      dispatch({ type: 'reveal' });
    }, visibleAfterMs);
  }, [clearTimer, visibleAfterMs]);

  const begin = useCallback(() => {
    countRef.current += 1;
    dispatch({ type: 'begin' });
    if (timerRef.current === null && !revealedRef.current) armTimer();
  }, [armTimer]);

  const end = useCallback(() => {
    countRef.current = Math.max(0, countRef.current - 1);
    dispatch({ type: 'end' });
    if (countRef.current === 0) {
      clearTimer();
      revealedRef.current = false;
      return;
    }
    // Deliberately no re-arm: the timer already runs from the moment the
    // queue stopped being empty, so what it measures is how long the user has
    // been waiting with *something* outstanding. Restarting it here would let
    // a stream of quick saves keep postponing a slow one's indicator forever.
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  return { countRef, saving: state.saving, begin, end };
}
