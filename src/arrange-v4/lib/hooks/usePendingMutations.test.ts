import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  initialPendingMutationsState,
  pendingMutationsReducer,
  type PendingMutationsAction,
  type PendingMutationsState,
} from './usePendingMutations';

function run(actions: PendingMutationsAction[]): PendingMutationsState {
  return actions.reduce(pendingMutationsReducer, initialPendingMutationsState);
}

describe('pendingMutationsReducer', () => {
  it('stays quiet until the reveal delay elapses', () => {
    assert.deepEqual(run([{ type: 'begin' }]), { count: 1, saving: false });
  });

  it('shows saving when the delay elapses with a write still in flight', () => {
    assert.deepEqual(run([{ type: 'begin' }, { type: 'reveal' }]), { count: 1, saving: true });
  });

  it('stays quiet when the write lands before the delay elapses', () => {
    assert.deepEqual(
      run([{ type: 'begin' }, { type: 'end' }, { type: 'reveal' }]),
      { count: 0, saving: false },
    );
  });

  it('keeps showing saving while later writes are still queued', () => {
    assert.deepEqual(
      run([{ type: 'begin' }, { type: 'begin' }, { type: 'reveal' }, { type: 'end' }]),
      { count: 1, saving: true },
    );
  });

  it('hides saving once the last write settles', () => {
    assert.deepEqual(
      run([{ type: 'begin' }, { type: 'begin' }, { type: 'reveal' }, { type: 'end' }, { type: 'end' }]),
      { count: 0, saving: false },
    );
  });

  it('clamps the count so a stray end cannot hide a later write', () => {
    const afterStrayEnd = run([{ type: 'end' }, { type: 'end' }]);
    assert.equal(afterStrayEnd.count, 0);
    const afterBegin = pendingMutationsReducer(afterStrayEnd, { type: 'begin' });
    assert.deepEqual(pendingMutationsReducer(afterBegin, { type: 'reveal' }), {
      count: 1,
      saving: true,
    });
  });
});
