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
    const twice = composeReconcileFailure('Failed to save order.', 'Offline', 'board');
    assert.equal(twice, once);
  });

  it('replaces the refresh sentence instead of stacking when the reason changes', () => {
    const first = composeReconcileFailure('Failed to save order.', 'Offline', 'board');
    const second = composeReconcileFailure('Failed to save order.', 'Request timed out', 'board');
    assert.equal(
      second,
      'Failed to save order. The board could not be refreshed either: Request timed out',
    );
    assert.equal(first.includes('Offline'), true);
    assert.equal(second.includes('Offline'), false);
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
