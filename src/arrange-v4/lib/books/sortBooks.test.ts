import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { Book } from '../store/types';
import { compareBooksByName, insertBookSorted, sortBooks } from './sortBooks';

function book(name: string, id = `cal:${name}`): Book {
  return { id, name, backend: 'calendar' };
}

const names = (books: readonly Book[]) => books.map(b => b.name);

describe('sortBooks', () => {
  test('orders books alphabetically', () => {
    const sorted = sortBooks([book('Work'), book('Admin'), book('Personal')]);
    assert.deepEqual(names(sorted), ['Admin', 'Personal', 'Work']);
  });

  test('ignores case so neighbours are not split apart', () => {
    const sorted = sortBooks([book('beta'), book('Alpha'), book('BETA chores')]);
    assert.deepEqual(names(sorted), ['Alpha', 'beta', 'BETA chores']);
  });

  test('orders embedded numbers numerically', () => {
    const sorted = sortBooks([book('Sprint 10'), book('Sprint 2'), book('Sprint 1')]);
    assert.deepEqual(names(sorted), ['Sprint 1', 'Sprint 2', 'Sprint 10']);
  });

  test('breaks ties on id so duplicate names keep a stable order', () => {
    const first = book('Work', 'cal:a');
    const second = book('Work', 'cal:b');
    assert.ok(compareBooksByName(first, second) < 0);
    assert.ok(compareBooksByName(second, first) > 0);
    assert.deepEqual(
      sortBooks([second, first]).map(b => b.id),
      ['cal:a', 'cal:b'],
    );
  });

  test('does not mutate the input array', () => {
    const input = [book('Work'), book('Admin')];
    sortBooks(input);
    assert.deepEqual(names(input), ['Work', 'Admin']);
  });

  test('tolerates an empty name', () => {
    const sorted = sortBooks([book('Work'), book('', 'cal:empty')]);
    assert.deepEqual(names(sorted), ['', 'Work']);
  });
});

describe('insertBookSorted', () => {
  test('places a new book in order rather than at the end', () => {
    const existing = sortBooks([book('Admin'), book('Work')]);
    assert.deepEqual(names(insertBookSorted(existing, book('Personal'))), [
      'Admin',
      'Personal',
      'Work',
    ]);
  });

  test('appends when the new book sorts last', () => {
    const existing = sortBooks([book('Admin'), book('Personal')]);
    assert.deepEqual(names(insertBookSorted(existing, book('Zebra'))), [
      'Admin',
      'Personal',
      'Zebra',
    ]);
  });

  test('prepends when the new book sorts first', () => {
    const existing = sortBooks([book('Personal'), book('Work')]);
    assert.deepEqual(names(insertBookSorted(existing, book('Admin'))), [
      'Admin',
      'Personal',
      'Work',
    ]);
  });

  test('inserts into an empty list', () => {
    assert.deepEqual(names(insertBookSorted([], book('Only'))), ['Only']);
  });

  test('replaces an existing entry with the same id instead of duplicating it', () => {
    const existing = [book('Admin', 'cal:1'), book('Work', 'cal:2')];
    const renamed: Book = { id: 'cal:2', name: 'Alpha', backend: 'calendar' };
    const next = insertBookSorted(existing, renamed);
    assert.deepEqual(names(next), ['Admin', 'Alpha']);
    assert.equal(next.length, 2);
  });

  test('does not mutate the input array', () => {
    const existing = [book('Admin'), book('Work')];
    insertBookSorted(existing, book('Personal'));
    assert.deepEqual(names(existing), ['Admin', 'Work']);
  });
});
