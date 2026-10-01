'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * False while rendering on the server and during the initial hydration render,
 * true from the first client-only render onwards.
 *
 * The app is statically exported, so the pre-rendered HTML cannot see
 * `localStorage`. Any decision that depends on browser-only state must wait for
 * this to flip, otherwise it runs against placeholder values baked in at build
 * time.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
