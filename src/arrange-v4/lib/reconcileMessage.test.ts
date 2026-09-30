import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { composeReconcileFailure } from './reconcileMessage';

describe('composeReconcileFailure', () => {
  it('uses the refresh message alone when nothing was showing', () => {
    assert.equal(composeReconcileFailure(null, 'Offline', 'board'), 'Offline');
  });

  it('keeps the write failure and adds why it could not be verified', () => {
    assert.equal(
      composeReconcileFailure('Failed to save order.', 'Offline', 'board'),
      'Failed to save order. The board could not be refreshed either: Offline',
    );
  });

  it('does not repeat itself when the same refresh keeps failing', () => {
    const once = composeReconcileFailure('Failed to save order.', 'Offline', 'board');
    const twice = composeReconcileFailure(once, 'Offline', 'board');
    const thrice = composeReconcileFailure(twice, 'Offline', 'board');
    assert.equal(twice, once);
    assert.equal(thrice, once);
  });

  it('does not read as two failures when both messages are the same', () => {
    assert.equal(
      composeReconcileFailure('Failed to fetch', 'Failed to fetch', 'list'),
      'The list could not be refreshed either: Failed to fetch',
    );
  });

  it('names the view it was given', () => {
    assert.match(composeReconcileFailure('Delete failed.', 'Offline', 'list'), /The list could not/);
  });
});
