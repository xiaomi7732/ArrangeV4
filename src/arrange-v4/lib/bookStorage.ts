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

export function getLastBookId(): string | null {
  if (!isLocalStorageAvailable()) return null;
  try {
    return localStorage.getItem(LAST_BOOK_ID_KEY);
  } catch {
    return null;
  }
}

export function setLastBookId(bookId: string): void {
  if (!isLocalStorageAvailable()) return;
  try {
    localStorage.setItem(LAST_BOOK_ID_KEY, bookId);
  } catch {
    // Storage full or blocked — silently ignore
  }
}

export function clearLastBookId(): void {
  if (!isLocalStorageAvailable()) return;
  try {
    localStorage.removeItem(LAST_BOOK_ID_KEY);
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
