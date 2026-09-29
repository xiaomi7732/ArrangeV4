import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { retainExistingIds } from './selectionUtils';

describe('retainExistingIds', () => {
  it('keeps selected IDs that still exist after a refresh', () => {
    assert.deepEqual(
      retainExistingIds(new Set(['a', 'b']), ['b', 'c']),
      new Set(['b']),
    );
  });

  it('does not mutate the original selection', () => {
    const selected = new Set(['a']);

    const retained = retainExistingIds(selected, ['a']);

    assert.notEqual(retained, selected);
    assert.deepEqual(selected, new Set(['a']));
  });
});
