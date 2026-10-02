import { strict as assert } from 'node:assert';
import test from 'node:test';
// Relative import: the test build does not rewrite the "@/" path alias.
import { keepStoredOrder, normalizeOrder, sortByPersistedOrder } from './orderUtils';
import type { TodoItemWithId } from './store/types';

function item(id: string, extra: Partial<TodoItemWithId> = {}): TodoItemWithId {
  return {
    id,
    subject: id,
    status: 'new',
    urgent: false,
    important: false,
    ...extra,
  } as TodoItemWithId;
}

const bySubject = (a: TodoItemWithId, b: TodoItemWithId) => a.subject.localeCompare(b.subject);

test('places an item with no saved order without tying one that has it', () => {
  const unordered = item('u');
  const saved = item('a', { matrixOrder: 1024 });
  const later = item('b', { matrixOrder: 2048 });

  const oneWay = sortByPersistedOrder([saved, unordered, later], 'matrixOrder', bySubject);
  const otherWay = sortByPersistedOrder([later, unordered, saved], 'matrixOrder', bySubject);

  assert.deepEqual(oneWay.map(i => i.id), ['u', 'a', 'b']);
  assert.deepEqual(otherWay.map(i => i.id), oneWay.map(i => i.id));
});

test('keeps items with no saved order in their fallback sequence', () => {
  const sorted = sortByPersistedOrder(
    [item('c'), item('a'), item('b')],
    'scrumOrder',
    bySubject,
  );
  assert.deepEqual(sorted.map(i => i.id), ['a', 'b', 'c']);
});

test('shows an unwritable item at its saved position, not its dragged one', () => {
  const stored = [item('u', { dataUnreadable: true }), item('a', { matrixOrder: 1024 })];
  const { items: normalized } = normalizeOrder([stored[1], stored[0]], 'matrixOrder');

  const shown = keepStoredOrder(normalized, stored, 'matrixOrder');

  assert.equal(shown.find(i => i.id === 'u')?.matrixOrder, undefined);
  assert.equal(shown.find(i => i.id === 'a')?.matrixOrder, 1024);
});

test('leaves readable items at their new position', () => {
  const stored = [item('a', { matrixOrder: 1024 }), item('b', { matrixOrder: 2048 })];
  const { items: normalized } = normalizeOrder([stored[1], stored[0]], 'matrixOrder');

  const shown = keepStoredOrder(normalized, stored, 'matrixOrder');

  assert.deepEqual(
    shown.map(i => [i.id, i.matrixOrder]),
    [['b', 1024], ['a', 2048]],
  );
});
