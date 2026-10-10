/**
 * The book list last fetched for a backend, kept outside React.
 *
 * Every page fetches its own books, so moving between views used to blank the
 * book switcher for the length of a round trip. Caching the previous answer
 * lets the switcher render immediately while the fresh fetch runs; the cache
 * decides only what is on screen in the meantime, never what is saved.
 *
 * Note: this module is compiled by tsconfig.test.json, which does not rewrite
 * the "@/" path alias, so imports here must stay relative.
 */
import type { BackendKind, Book } from '../store/types';

const cache = new Map<BackendKind, Book[]>();

/**
 * Bumped every time the cache is dropped. A fetch that started before the drop
 * must not refill it afterwards: it may be answering for the account that just
 * signed out, or for a book list that has since changed.
 */
let generation = 0;

export function cacheGeneration(): number {
  return generation;
}

export function getCachedBooks(backend: BackendKind): Book[] {
  return cache.get(backend) ?? [];
}

export function setCachedBooks(
  backend: BackendKind,
  books: Book[],
  atGeneration: number = generation,
): void {
  if (atGeneration !== generation) return;
  cache.set(backend, [...books]);
}

/**
 * Drops the cache. Called on sign-out, so a different account never catches a
 * glimpse of the previous one's books, and after a book is created or deleted,
 * so the switcher cannot show a list that is known to be wrong.
 */
export function clearCachedBooks(): void {
  cache.clear();
  generation += 1;
}
