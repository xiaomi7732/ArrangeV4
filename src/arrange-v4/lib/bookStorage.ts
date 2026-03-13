const LAST_BOOK_ID_KEY = 'lastBookId';

export function getLastBookId(): string | null {
  return localStorage.getItem(LAST_BOOK_ID_KEY);
}

export function setLastBookId(bookId: string): void {
  localStorage.setItem(LAST_BOOK_ID_KEY, bookId);
}

export function clearLastBookId(): void {
  localStorage.removeItem(LAST_BOOK_ID_KEY);
}
