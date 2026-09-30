import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nextFocusTarget } from './useModalDialog';

const focusable = ['first', 'middle', 'last'];

describe('nextFocusTarget', () => {
  it('lets the browser handle a move between interior controls', () => {
    assert.equal(nextFocusTarget({ focusable, active: 'first', shiftKey: false }), null);
    assert.equal(nextFocusTarget({ focusable, active: 'middle', shiftKey: false }), null);
    assert.equal(nextFocusTarget({ focusable, active: 'middle', shiftKey: true }), null);
    assert.equal(nextFocusTarget({ focusable, active: 'last', shiftKey: true }), null);
  });

  it('wraps forward off the last control', () => {
    assert.equal(nextFocusTarget({ focusable, active: 'last', shiftKey: false }), 'first');
  });

  it('wraps backward off the first control', () => {
    assert.equal(nextFocusTarget({ focusable, active: 'first', shiftKey: true }), 'last');
  });

  it('pulls focus in when it is outside the dialog', () => {
    assert.equal(nextFocusTarget({ focusable, active: null, shiftKey: false }), 'first');
    assert.equal(nextFocusTarget({ focusable, active: null, shiftKey: true }), 'last');
  });

  it('has nowhere to send focus in an empty dialog', () => {
    assert.equal(nextFocusTarget({ focusable: [], active: null, shiftKey: false }), null);
  });

  it('treats a single control as both ends', () => {
    const only = ['only'];
    assert.equal(nextFocusTarget({ focusable: only, active: 'only', shiftKey: false }), 'only');
    assert.equal(nextFocusTarget({ focusable: only, active: 'only', shiftKey: true }), 'only');
  });
});
