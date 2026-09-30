import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { bannerDerivesFrom, composeReconcileFailure } from './reconcileMessage';

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

describe('bannerDerivesFrom', () => {
  it('recognises the write failure on its own', () => {
    assert.equal(bannerDerivesFrom('Failed to save order.', 'Failed to save order.', 'board'), true);
  });

  it('recognises the write failure with a refresh sentence appended', () => {
    const banner = composeReconcileFailure('Failed to save order.', 'Offline', 'board');
    assert.equal(bannerDerivesFrom(banner, 'Failed to save order.', 'board'), true);
  });

  it('recognises the collapsed form, which keeps none of the write text', () => {
    const banner = composeReconcileFailure('Failed to fetch', 'Failed to fetch', 'board');
    assert.equal(banner.startsWith('Failed to fetch'), false);
    assert.equal(bannerDerivesFrom(banner, 'Failed to fetch', 'board'), true);
  });

  it('leaves a message raised some other way alone', () => {
    assert.equal(bannerDerivesFrom('Login failed. Please try again.', 'Failed to fetch', 'board'), false);
    assert.equal(bannerDerivesFrom(null, 'Failed to fetch', 'board'), false);
  });
});
