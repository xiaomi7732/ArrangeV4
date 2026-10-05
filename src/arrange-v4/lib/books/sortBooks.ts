import type { Book } from '@/lib/store/types';

/**
 * Ordering for the book lists and switchers.
 *
 * Backends return books in whatever order their API happens to use — Graph by
 * creation, Drive by its own relevance ranking — which gives the same account a
 * different order on each page and makes a book hard to find once there are
 * more than a handful.
 *
 * `numeric` so "Sprint 2" sorts before "Sprint 10", and `sensitivity: 'base'`
 * so case and accents do not split names that read as neighbours. The ID is the
 * final tie-break, so two books sharing a name keep a stable, repeatable order
 * instead of swapping places between renders.
 */
const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

export function compareBooksByName(a: Book, b: Book): number {
  const byName = collator.compare(a.name || '', b.name || '');
  if (byName !== 0) return byName;
  return a.id.localeCompare(b.id);
}

/** Sorted copy; the input array is left alone. */
export function sortBooks(books: readonly Book[]): Book[] {
  return [...books].sort(compareBooksByName);
}

/**
 * Adds a book to an already-sorted list without re-sorting it.
 *
 * Appending a newly created book would drop it at the bottom, out of order,
 * until the next refresh — the one moment the user is most likely to go looking
 * for it.
 */
export function insertBookSorted(books: readonly Book[], book: Book): Book[] {
  const next = books.filter(existing => existing.id !== book.id);
  const index = next.findIndex(existing => compareBooksByName(book, existing) < 0);
  if (index === -1) return [...next, book];
  return [...next.slice(0, index), book, ...next.slice(index)];
}
