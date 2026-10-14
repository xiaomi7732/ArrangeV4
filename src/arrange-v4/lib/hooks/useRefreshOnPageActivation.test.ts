import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getActivationRefreshTimestamp,
  initialActivationRefreshState,
  reduceActivationRefresh,
} from './useRefreshOnPageActivation';

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

describe('reduceActivationRefresh', () => {
  const visibleActivation = {
    type: 'activation' as const,
    enabled: true,
    visible: true,
    suspended: false,
    now: 5000,
  };

  it('refreshes on a plain activation', () => {
    const result = reduceActivationRefresh(initialActivationRefreshState, visibleActivation);
    assert.equal(result.refresh, true);
    assert.deepEqual(result.state, { lastRefreshAt: 5000, deferred: false });
  });

  it('ignores an activation on a disabled or hidden page', () => {
    for (const event of [
      { ...visibleActivation, enabled: false },
      { ...visibleActivation, visible: false },
    ]) {
      const result = reduceActivationRefresh(initialActivationRefreshState, event);
      assert.equal(result.refresh, false);
      assert.deepEqual(result.state, initialActivationRefreshState);
    }
  });

  it('deduplicates the paired visibility and focus events', () => {
    const first = reduceActivationRefresh(initialActivationRefreshState, visibleActivation);
    const second = reduceActivationRefresh(first.state, { ...visibleActivation, now: 5100 });
    assert.equal(second.refresh, false);
    assert.deepEqual(second.state, first.state);
  });

  it('holds a refresh back while a dialog is open, then runs it once on close', () => {
    const held = reduceActivationRefresh(initialActivationRefreshState, {
      ...visibleActivation,
      suspended: true,
    });
    assert.equal(held.refresh, false);
    assert.deepEqual(held.state, { lastRefreshAt: null, deferred: true });

    const stillOpen = reduceActivationRefresh(held.state, {
      type: 'resume',
      enabled: true,
      visible: true,
      suspended: true,
      now: 6000,
    });
    assert.equal(stillOpen.refresh, false);
    assert.equal(stillOpen.state.deferred, true);

    const closed = reduceActivationRefresh(held.state, {
      type: 'resume',
      enabled: true,
      visible: true,
      suspended: false,
      now: 6000,
    });
    assert.equal(closed.refresh, true);
    assert.deepEqual(closed.state, { lastRefreshAt: 6000, deferred: false });

    const afterwards = reduceActivationRefresh(closed.state, {
      type: 'resume',
      enabled: true,
      visible: true,
      suspended: false,
      now: 7000,
    });
    assert.equal(afterwards.refresh, false);
  });

  it('keeps a held refresh owed while the page is disabled or hidden', () => {
    const held = reduceActivationRefresh(initialActivationRefreshState, {
      ...visibleActivation,
      suspended: true,
    });

    for (const event of [
      { type: 'resume' as const, enabled: false, visible: true, suspended: false, now: 6000 },
      { type: 'resume' as const, enabled: true, visible: false, suspended: false, now: 6000 },
    ]) {
      const result = reduceActivationRefresh(held.state, event);
      assert.equal(result.refresh, false);
      assert.equal(result.state.deferred, true);
    }
  });

  it('has nothing to do on a resume when no refresh was held back', () => {
    const result = reduceActivationRefresh(initialActivationRefreshState, {
      type: 'resume',
      enabled: true,
      visible: true,
      suspended: false,
      now: 6000,
    });
    assert.equal(result.refresh, false);
    assert.deepEqual(result.state, initialActivationRefreshState);
  });

  it('owes nothing extra for the paired event behind a suspended activation', () => {
    const held = reduceActivationRefresh(initialActivationRefreshState, {
      ...visibleActivation,
      suspended: true,
    });
    // The focus event lands right behind the visibility one; the dedupe window
    // has nothing to compare against yet, so only the debt must hold it.
    const pair = reduceActivationRefresh(held.state, {
      ...visibleActivation,
      suspended: true,
      now: 5100,
    });
    assert.equal(pair.refresh, false);
    assert.deepEqual(pair.state, { lastRefreshAt: null, deferred: true });

    const closed = reduceActivationRefresh(pair.state, {
      type: 'resume',
      enabled: true,
      visible: true,
      suspended: false,
      now: 6000,
    });
    assert.equal(closed.refresh, true);
  });
});
