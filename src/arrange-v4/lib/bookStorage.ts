const LAST_BOOK_ID_KEY = 'arrange_lastBookId';
const SESSION_SWEEP_KEY = 'arrange_sweepDone';

function isStorageAvailable(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
}

export function getLastBookId(): string | null {
  if (!isStorageAvailable()) return null;
  try {
    return localStorage.getItem(LAST_BOOK_ID_KEY);
  } catch {
    return null;
  }
}

export function setLastBookId(bookId: string): void {
  if (!isStorageAvailable()) return;
  try {
    localStorage.setItem(LAST_BOOK_ID_KEY, bookId);
  } catch {
    // Storage full or blocked — silently ignore
  }
}

export function clearLastBookId(): void {
  if (!isStorageAvailable()) return;
  try {
    localStorage.removeItem(LAST_BOOK_ID_KEY);
  } catch {
    // Silently ignore
  }
}

export function hasSessionSweepRun(): boolean {
  if (!isStorageAvailable()) return true;
  try {
    return sessionStorage.getItem(SESSION_SWEEP_KEY) === 'true';
  } catch {
    return true;
  }
}

export function markSessionSweepDone(): void {
  if (!isStorageAvailable()) return;
  try {
    sessionStorage.setItem(SESSION_SWEEP_KEY, 'true');
  } catch {
    // Silently ignore
  }
}
