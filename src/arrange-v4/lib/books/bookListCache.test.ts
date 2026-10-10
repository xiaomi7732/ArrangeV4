import { strict as assert } from 'node:assert';
import { beforeEach, describe, it } from 'node:test';
import type { Book } from '../store/types';
import {
  cacheGeneration,
  clearCachedBooks,
  getCachedBooks,
  setCachedBooks,
} from './bookListCache';

function book(id: string, name: string): Book {
  return { id, name } as Book;
}

beforeEach(() => {
  clearCachedBooks();
});

describe('bookListCache', () => {
  it('keeps each backend s list apart', () => {
    setCachedBooks('calendar', [book('calendar:1', 'Work')]);
    setCachedBooks('google', [book('google:1', 'Home')]);

    assert.deepEqual(getCachedBooks('calendar').map(b => b.name), ['Work']);
    assert.deepEqual(getCachedBooks('google').map(b => b.name), ['Home']);
  });

  it('returns an empty list for a backend never fetched', () => {
    assert.deepEqual(getCachedBooks('calendar'), []);
  });

  it('copies on write, so a caller cannot mutate the cache by accident', () => {
    const books = [book('calendar:1', 'Work')];
    setCachedBooks('calendar', books);
    books.push(book('calendar:2', 'Later'));

    assert.equal(getCachedBooks('calendar').length, 1);
  });

  it('ignores a write captured before the cache was dropped', () => {
    const generation = cacheGeneration();
    setCachedBooks('calendar', [book('calendar:1', 'Work')]);

    // The account signs out while a list request is still in flight.
    clearCachedBooks();
    setCachedBooks('calendar', [book('calendar:1', 'Work')], generation);

    assert.deepEqual(getCachedBooks('calendar'), []);
  });

  it('accepts a write captured after the drop', () => {
    clearCachedBooks();
    const generation = cacheGeneration();
    setCachedBooks('calendar', [book('calendar:2', 'Fresh')], generation);

    assert.deepEqual(getCachedBooks('calendar').map(b => b.name), ['Fresh']);
  });
});
