'use client';

import { useEffect, useRef } from 'react';

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

export function useRefreshOnPageActivation(
  refresh: () => void,
  enabled: boolean,
): void {
  const refreshRef = useRef(refresh);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;

    let lastRefreshAt: number | null = null;
    const handleActivation = () => {
      const refreshAt = getActivationRefreshTimestamp({
        enabled,
        visible: document.visibilityState === 'visible',
        now: Date.now(),
        lastRefreshAt,
      });
      if (refreshAt === null) return;
      lastRefreshAt = refreshAt;
      refreshRef.current();
    };

    document.addEventListener('visibilitychange', handleActivation);
    window.addEventListener('focus', handleActivation);
    return () => {
      document.removeEventListener('visibilitychange', handleActivation);
      window.removeEventListener('focus', handleActivation);
    };
  }, [enabled]);
}
