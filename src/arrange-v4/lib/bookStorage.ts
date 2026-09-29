import { parseBookId, type BackendKind } from '@/lib/store/types';

const LAST_BOOK_ID_KEY = 'arrange_lastBookId';
const SESSION_SWEEP_KEY = 'arrange_sweepDone';
const SESSION_SWEEP_IN_PROGRESS_KEY = 'arrange_sweepInProgress';
const SWEEP_STALE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

function isLocalStorageAvailable(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
}

function isSessionStorageAvailable(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.sessionStorage;
  } catch {
    return false;
  }
}

function lastBookKey(backend: BackendKind): string {
  return `${LAST_BOOK_ID_KEY}_${backend}`;
}

export function getLastBookId(backend: BackendKind): string | null {
  if (!isLocalStorageAvailable()) return null;
  try {
    const stored = localStorage.getItem(lastBookKey(backend));
    if (stored) return stored;

    const legacy = localStorage.getItem(LAST_BOOK_ID_KEY);
    if (legacy && parseBookId(legacy)?.backend === backend) {
      localStorage.setItem(lastBookKey(backend), legacy);
      localStorage.removeItem(LAST_BOOK_ID_KEY);
      return legacy;
    }
    return null;
  } catch {
    return null;
  }
}

export function setLastBookId(bookId: string): void {
  if (!isLocalStorageAvailable()) return;
  try {
    const backend = parseBookId(bookId)?.backend;
    if (!backend) return;
    localStorage.setItem(lastBookKey(backend), bookId);
    const legacy = localStorage.getItem(LAST_BOOK_ID_KEY);
    if (legacy && parseBookId(legacy)?.backend === backend) {
      localStorage.removeItem(LAST_BOOK_ID_KEY);
    }
  } catch {
    // Storage full or blocked — silently ignore
  }
}

export function clearLastBookId(backend: BackendKind): void {
  if (!isLocalStorageAvailable()) return;
  try {
    localStorage.removeItem(lastBookKey(backend));
  } catch {
    // Silently ignore
  }
}

export function hasSessionSweepRun(): boolean {
  if (!isSessionStorageAvailable()) return false;
  try {
    const status = sessionStorage.getItem(SESSION_SWEEP_KEY);
    return status === 'true';
  } catch {
    return false;
  }
}

export function isSessionSweepInProgress(): boolean {
  if (!isSessionStorageAvailable()) return false;
  try {
    const startedAt = sessionStorage.getItem(SESSION_SWEEP_IN_PROGRESS_KEY);
    if (!startedAt) return false;
    const ts = Number(startedAt);
    if (!Number.isFinite(ts)) {
      sessionStorage.removeItem(SESSION_SWEEP_IN_PROGRESS_KEY);
      return false;
    }
    const elapsed = Date.now() - ts;
    if (elapsed > SWEEP_STALE_THRESHOLD_MS) {
      sessionStorage.removeItem(SESSION_SWEEP_IN_PROGRESS_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function markSessionSweepInProgress(): void {
  if (!isSessionStorageAvailable()) return;
  try {
    sessionStorage.setItem(SESSION_SWEEP_IN_PROGRESS_KEY, String(Date.now()));
  } catch {
    // Silently ignore
  }
}

export function clearSessionSweepInProgress(): void {
  if (!isSessionStorageAvailable()) return;
  try {
    sessionStorage.removeItem(SESSION_SWEEP_IN_PROGRESS_KEY);
  } catch {
    // Silently ignore
  }
}

export function markSessionSweepDone(): void {
  if (!isSessionStorageAvailable()) return;
  try {
    sessionStorage.setItem(SESSION_SWEEP_KEY, 'true');
  } catch {
    // Silently ignore
  }
}
