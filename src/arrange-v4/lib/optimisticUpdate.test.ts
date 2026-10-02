import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { dropUnwritableUpdates, restoreSnapshot, snapshotItems } from './optimisticUpdate';

interface Row {
  id: string;
  value: string;
}

const rows: Row[] = [
  { id: 'a', value: 'A' },
  { id: 'b', value: 'B' },
  { id: 'c', value: 'C' },
];

describe('snapshotItems', () => {
  it('captures only the requested items, in list order', () => {
    assert.deepEqual(snapshotItems(rows, ['c', 'a']), [
      { id: 'a', value: 'A' },
      { id: 'c', value: 'C' },
    ]);
  });

  it('returns nothing for an empty id set', () => {
    assert.deepEqual(snapshotItems(rows, []), []);
  });

  it('ignores ids that are not present', () => {
    assert.deepEqual(snapshotItems(rows, ['zz']), []);
  });

  it('captures references, so later mutation of the list cannot alter it', () => {
    const snapshot = snapshotItems(rows, ['b']);
    const mutated = rows.map(row => (row.id === 'b' ? { ...row, value: 'CHANGED' } : row));
    assert.equal(snapshot[0].value, 'B');
    assert.equal(mutated[1].value, 'CHANGED');
  });
});

describe('restoreSnapshot', () => {
  it('puts the original values back', () => {
    const snapshot = snapshotItems(rows, ['b']);
    const optimistic = rows.map(row => (row.id === 'b' ? { ...row, value: 'OPTIMISTIC' } : row));

    assert.deepEqual(restoreSnapshot(optimistic, snapshot), rows);
  });

  it('leaves untouched items alone', () => {
    const snapshot = snapshotItems(rows, ['a']);
    const optimistic = rows.map(row =>
      row.id === 'a' ? { ...row, value: 'OPTIMISTIC' } : { ...row, value: `${row.value}!` },
    );

    const result = restoreSnapshot(optimistic, snapshot);
    assert.equal(result[0].value, 'A');
    assert.equal(result[1].value, 'B!');
    assert.equal(result[2].value, 'C!');
  });

  it('does not resurrect an item that has since been removed', () => {
    const snapshot = snapshotItems(rows, ['b']);
    const withoutB = rows.filter(row => row.id !== 'b');

    assert.deepEqual(restoreSnapshot(withoutB, snapshot), withoutB);
  });

  it('keeps the same array identity when nothing needs restoring', () => {
    const snapshot = snapshotItems(rows, ['b']);
    assert.equal(restoreSnapshot(rows, snapshot), rows);
  });

  it('keeps the same array identity for an empty snapshot', () => {
    assert.equal(restoreSnapshot(rows, []), rows);
  });

  it('restores several items at once', () => {
    const snapshot = snapshotItems(rows, ['a', 'c']);
    const optimistic = rows.map(row => ({ ...row, value: 'X' }));

    const result = restoreSnapshot(optimistic, snapshot);
    assert.deepEqual(result.map(row => row.value), ['A', 'X', 'C']);
  });
});

describe('dropUnwritableUpdates', () => {
  const items = [
    { id: 'a' },
    { id: 'b', dataUnreadable: true },
    { id: 'c' },
  ];

  it('skips an item whose saved data could not be read', () => {
    // The stores refuse such a write, and one of them in the lane would
    // otherwise fail the whole reorder batch.
    const updates = new Map([['a', 1], ['b', 2], ['c', 3]]);
    assert.deepEqual([...dropUnwritableUpdates(updates, items).keys()], ['a', 'c']);
  });

  it('copies the map when every item is writable', () => {
    const updates = new Map([['a', 1]]);
    const result = dropUnwritableUpdates(updates, [{ id: 'a' }]);
    assert.deepEqual([...result], [['a', 1]]);
    assert.notEqual(result, updates);
  });
});
