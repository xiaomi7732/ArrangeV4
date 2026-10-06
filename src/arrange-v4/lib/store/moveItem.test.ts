import test from 'node:test';
import assert from 'node:assert/strict';
import { itemForMove, moveItemToBook, PartialMoveError, type MoveCapableStore } from './moveItem';
import type { CreateItemOptions, TodoItem, TodoItemWithId } from './types';

function makeItem(overrides: Partial<TodoItemWithId> = {}): TodoItemWithId {
  return {
    id: 'item-1',
    subject: 'Write the report',
    status: 'inProgress',
    urgent: true,
    important: false,
    etsDateTime: '2026-01-01T09:00:00.000Z',
    etaDateTime: '2026-01-02T09:00:00.000Z',
    categories: ['work'],
    checklist: ['-[x] outline', '-[] draft'],
    remarks: { type: 'markdown', content: '**notes**' },
    matrixOrder: 3,
    scrumOrder: 7,
    source: { url: 'https://example.com/item-1', label: 'Open in Outlook' },
    ...overrides,
  };
}

interface Recorded {
  created: { bookId: string; item: TodoItem; options?: CreateItemOptions }[];
  deleted: { bookId: string; itemId: string }[];
}

function fakeStore(
  behaviour: { failDelete?: Error; failCreate?: Error } = {},
): MoveCapableStore & { recorded: Recorded } {
  const recorded: Recorded = { created: [], deleted: [] };
  return {
    recorded,
    async createItem(bookId: string, item: TodoItem, options?: CreateItemOptions) {
      if (behaviour.failCreate) throw behaviour.failCreate;
      recorded.created.push({ bookId, item, options });
      return { ...item, id: 'new-id' };
    },
    async deleteItem(bookId: string, itemId: string) {
      if (behaviour.failDelete) throw behaviour.failDelete;
      recorded.deleted.push({ bookId, itemId });
    },
  };
}

test('carries every user-entered field into the destination book', async () => {
  const store = fakeStore();
  const item = makeItem({
    originalEtsDateTime: '2025-12-01T09:00:00.000Z',
    originalEtaDateTime: '2025-12-02T09:00:00.000Z',
  });

  const created = await moveItemToBook(store, {
    fromBookId: 'cal:a',
    toBookId: 'cal:b',
    item,
  });

  assert.equal(store.recorded.created.length, 1);
  const written = store.recorded.created[0];
  assert.equal(written.bookId, 'cal:b');
  assert.equal(written.item.subject, 'Write the report');
  assert.equal(written.item.status, 'inProgress');
  assert.deepEqual(written.item.categories, ['work']);
  assert.deepEqual(written.item.checklist, ['-[x] outline', '-[] draft']);
  assert.deepEqual(written.item.remarks, { type: 'markdown', content: '**notes**' });
  assert.equal(written.item.originalEtsDateTime, '2025-12-01T09:00:00.000Z');
  assert.equal(written.item.originalEtaDateTime, '2025-12-02T09:00:00.000Z');
  assert.equal(created.id, 'new-id');
});

test('drops identity and board positions, which do not survive the move', () => {
  const moved = itemForMove(makeItem()) as Partial<TodoItemWithId>;
  assert.equal(moved.id, undefined);
  assert.equal(moved.source, undefined);
  assert.equal(moved.matrixOrder, undefined);
  assert.equal(moved.scrumOrder, undefined);
});

test('removes the item from the source book only after the copy lands', async () => {
  const store = fakeStore();
  await moveItemToBook(store, { fromBookId: 'cal:a', toBookId: 'cal:b', item: makeItem() });
  assert.deepEqual(store.recorded.deleted, [{ bookId: 'cal:a', itemId: 'item-1' }]);
});

test('leaves the source untouched when the copy fails', async () => {
  const store = fakeStore({ failCreate: new Error('quota exceeded') });
  await assert.rejects(
    moveItemToBook(store, { fromBookId: 'cal:a', toBookId: 'cal:b', item: makeItem() }),
    /quota exceeded/,
  );
  assert.deepEqual(store.recorded.deleted, []);
});

test('reports the duplicate when the source item cannot be removed', async () => {
  const store = fakeStore({ failDelete: new Error('network down') });
  await assert.rejects(
    moveItemToBook(store, { fromBookId: 'cal:a', toBookId: 'cal:b', item: makeItem() }),
    /exists in both/,
  );
  assert.equal(store.recorded.created.length, 1);
});

test('a half-finished move is reported as a PartialMoveError carrying the new id', async () => {
  const store = fakeStore({ failDelete: new Error('network down') });
  await assert.rejects(
    moveItemToBook(store, { fromBookId: 'cal:a', toBookId: 'cal:b', item: makeItem() }),
    (err: unknown) => err instanceof PartialMoveError && err.createdId === 'new-id',
  );
});

test('writes the copy without new-task defaults', async () => {
  const store = fakeStore();
  await moveItemToBook(store, { fromBookId: 'cal:a', toBookId: 'cal:b', item: makeItem() });
  assert.deepEqual(store.recorded.created[0].options, { asCopy: true });
});

test('refuses a move to the same book', async () => {
  const store = fakeStore();
  await assert.rejects(
    moveItemToBook(store, { fromBookId: 'cal:a', toBookId: 'cal:a', item: makeItem() }),
    /different book/,
  );
  assert.equal(store.recorded.created.length, 0);
});

test('refuses a move with no destination', async () => {
  const store = fakeStore();
  await assert.rejects(
    moveItemToBook(store, { fromBookId: 'cal:a', toBookId: '', item: makeItem() }),
    /different book/,
  );
});

test('refuses to move an item whose saved data could not be read', async () => {
  const store = fakeStore();
  await assert.rejects(
    moveItemToBook(store, {
      fromBookId: 'cal:a',
      toBookId: 'cal:b',
      item: makeItem({ dataUnreadable: true }),
    }),
    /cannot be read/,
  );
  assert.equal(store.recorded.created.length, 0);
  assert.deepEqual(store.recorded.deleted, []);
});
