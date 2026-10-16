'use client';

import { useCallback, useEffect, useRef } from 'react';

const ACTIVATION_DEDUPE_MS = 1000;

interface ActivationRefreshDecision {
  enabled: boolean;
  visible: boolean;
  now: number;
  lastRefreshAt: number | null;
}

export function getActivationRefreshTimestamp({
  enabled,
  visible,
  now,
  lastRefreshAt,
}: ActivationRefreshDecision): number | null {
  if (!enabled || !visible) return null;
  if (lastRefreshAt !== null && now - lastRefreshAt < ACTIVATION_DEDUPE_MS) {
    return null;
  }
  return now;
}

export interface ActivationRefreshState {
  /** When the last refresh went out, for deduplicating paired events. */
  lastRefreshAt: number | null;
  /** A refresh that was asked for while a dialog was up, still owed. */
  deferred: boolean;
}

export const initialActivationRefreshState: ActivationRefreshState = {
  lastRefreshAt: null,
  deferred: false,
};

export type ActivationRefreshEvent =
  /** The tab was focused or became visible. */
  | { type: 'activation'; enabled: boolean; visible: boolean; suspended: boolean; now: number }
  /** Something that was holding the refresh back changed. */
  | { type: 'resume'; enabled: boolean; visible: boolean; suspended: boolean; now: number };

/**
 * The whole decision of whether to refresh, kept pure so it can be tested.
 *
 * An activation that lands while a dialog is up is remembered rather than
 * dropped: the user is part-way through something a redraw would disturb, but
 * the data behind them really has gone stale, so the refresh runs the moment
 * the dialog closes.
 */
export function reduceActivationRefresh(
  state: ActivationRefreshState,
  event: ActivationRefreshEvent,
): { state: ActivationRefreshState; refresh: boolean } {
  if (event.type === 'activation') {
    const refreshAt = getActivationRefreshTimestamp({
      enabled: event.enabled,
      visible: event.visible,
      now: event.now,
      lastRefreshAt: state.lastRefreshAt,
    });
    if (refreshAt === null) return { state, refresh: false };
    if (event.suspended) {
      return { state: { ...state, deferred: true }, refresh: false };
    }
    return { state: { lastRefreshAt: refreshAt, deferred: false }, refresh: true };
  }

  // Nothing owed, or still not a moment to run it: the debt simply keeps.
  // Hidden counts as "not now" — refreshing a tab nobody is looking at wastes
  // a read, and the next activation will settle it.
  //
  // A read the page made on its own account in the meantime does not cancel
  // the debt, so the replay can occasionally be one read too many. Tracking
  // every page's reads here would cost more than the stray read does.
  if (!state.deferred || !event.enabled || event.suspended || !event.visible) {
    return { state, refresh: false };
  }
  return { state: { lastRefreshAt: event.now, deferred: false }, refresh: true };
}

interface RefreshOnPageActivationOptions {
  /**
   * Holds the refresh back without dropping it — for a dialog the user is
   * part-way through, which a redraw underneath would disturb. The refresh
   * runs once the dialog closes.
   */
  suspended?: boolean;
}

export function useRefreshOnPageActivation(
  refresh: () => void,
  enabled: boolean,
  { suspended = false }: RefreshOnPageActivationOptions = {},
): void {
  const refreshRef = useRef(refresh);
  const suspendedRef = useRef(suspended);
  const stateRef = useRef<ActivationRefreshState>(initialActivationRefreshState);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    suspendedRef.current = suspended;
  }, [suspended]);

  const dispatch = useCallback((event: ActivationRefreshEvent) => {
    const { state, refresh: shouldRefresh } = reduceActivationRefresh(stateRef.current, event);
    stateRef.current = state;
    if (shouldRefresh) refreshRef.current();
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const handleActivation = () => {
      dispatch({
        type: 'activation',
        enabled,
        visible: document.visibilityState === 'visible',
        suspended: suspendedRef.current,
        now: Date.now(),
      });
    };

    document.addEventListener('visibilitychange', handleActivation);
    window.addEventListener('focus', handleActivation);
    return () => {
      document.removeEventListener('visibilitychange', handleActivation);
      window.removeEventListener('focus', handleActivation);
    };
  }, [enabled, dispatch]);
  useEffect(() => {
    dispatch({
      type: 'resume',
      enabled,
      visible: document.visibilityState === 'visible',
      suspended,
      now: Date.now(),
    });
  }, [enabled, suspended, dispatch]);
}
