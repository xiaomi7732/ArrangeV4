import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getActivationRefreshTimestamp } from './useRefreshOnPageActivation';

describe('getActivationRefreshTimestamp', () => {
  it('does not refresh while the page is disabled or hidden', () => {
    assert.equal(getActivationRefreshTimestamp({
      enabled: false,
      visible: true,
      now: 5000,
      lastRefreshAt: null,
    }), null);
    assert.equal(getActivationRefreshTimestamp({
      enabled: true,
      visible: false,
      now: 5000,
      lastRefreshAt: null,
    }), null);
  });

  it('refreshes an enabled visible page', () => {
    assert.equal(getActivationRefreshTimestamp({
      enabled: true,
      visible: true,
      now: 5000,
      lastRefreshAt: null,
    }), 5000);
  });

  it('deduplicates paired visibility and focus events', () => {
    assert.equal(getActivationRefreshTimestamp({
      enabled: true,
      visible: true,
      now: 5500,
      lastRefreshAt: 5000,
    }), null);
    assert.equal(getActivationRefreshTimestamp({
      enabled: true,
      visible: true,
      now: 6000,
      lastRefreshAt: 5000,
    }), 6000);
  });
});
