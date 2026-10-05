import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasUnsavedChanges,
  normalizeSnapshotValue,
  resolveCloseIntent,
} from './unsavedChanges';

describe('hasUnsavedChanges', () => {
  test('an untouched form is clean', () => {
    const baseline = { subject: 'Ship it', urgent: false, checklist: ['a'] };
    assert.equal(hasUnsavedChanges({ ...baseline }, baseline), false);
  });

  test('a changed string is dirty', () => {
    assert.equal(
      hasUnsavedChanges({ subject: 'Ship it now' }, { subject: 'Ship it' }),
      true,
    );
  });

  test('a changed boolean is dirty', () => {
    assert.equal(hasUnsavedChanges({ urgent: true }, { urgent: false }), true);
  });

  test('treats undefined and null as the same absent value', () => {
    assert.equal(hasUnsavedChanges({ remarks: undefined }, { remarks: null }), false);
    assert.equal(hasUnsavedChanges({ remarks: null }, { remarks: undefined }), false);
  });

  test('does not confuse an absent value with an empty string', () => {
    assert.equal(hasUnsavedChanges({ remarks: '' }, { remarks: null }), true);
  });

  test('compares arrays element-wise and in order', () => {
    assert.equal(hasUnsavedChanges({ checklist: ['a', 'b'] }, { checklist: ['a', 'b'] }), false);
    assert.equal(hasUnsavedChanges({ checklist: ['b', 'a'] }, { checklist: ['a', 'b'] }), true);
    assert.equal(hasUnsavedChanges({ checklist: ['a'] }, { checklist: ['a', 'b'] }), true);
  });

  test('an emptied array differs from an absent one', () => {
    assert.equal(hasUnsavedChanges({ checklist: [] }, { checklist: null }), true);
  });

  test('ignores object key order', () => {
    assert.equal(
      hasUnsavedChanges(
        { remarks: { type: 'markdown', content: 'hi' } },
        { remarks: { content: 'hi', type: 'markdown' } },
      ),
      false,
    );
  });

  test('detects a nested change', () => {
    assert.equal(
      hasUnsavedChanges(
        { remarks: { type: 'text', content: 'hi' } },
        { remarks: { type: 'markdown', content: 'hi' } },
      ),
      true,
    );
  });

  test('keeps whitespace significant, because remarks are Markdown', () => {
    assert.equal(hasUnsavedChanges({ remarks: '  code' }, { remarks: 'code' }), true);
    assert.equal(hasUnsavedChanges({ remarks: 'text\n' }, { remarks: 'text' }), true);
  });

  test('a field present in only one snapshot counts as a change', () => {
    assert.equal(hasUnsavedChanges({ subject: 'a', extra: 1 }, { subject: 'a' }), true);
  });

  test('an untouched NaN field is not reported as edited', () => {
    assert.equal(hasUnsavedChanges({ order: NaN }, { order: NaN }), false);
  });

  test('an empty form against an empty baseline is clean', () => {
    assert.equal(hasUnsavedChanges({}, {}), false);
  });
});

describe('normalizeSnapshotValue', () => {
  test('folds undefined to null', () => {
    assert.equal(normalizeSnapshotValue(undefined), null);
  });

  test('sorts object keys', () => {
    assert.deepEqual(
      Object.keys(normalizeSnapshotValue({ b: 1, a: 2 }) as object),
      ['a', 'b'],
    );
  });

  test('normalizes values nested inside arrays', () => {
    assert.deepEqual(normalizeSnapshotValue([undefined, 'a']), [null, 'a']);
  });

  test('reduces a date to its instant', () => {
    assert.equal(normalizeSnapshotValue(new Date(1700000000000)), 1700000000000);
  });
});

describe('resolveCloseIntent', () => {
  test('closes straight away when there is nothing to lose', () => {
    assert.equal(resolveCloseIntent({ dirty: false, busy: false }), 'close');
  });

  test('asks first when there are unsaved edits', () => {
    assert.equal(resolveCloseIntent({ dirty: true, busy: false }), 'confirm');
  });

  test('ignores the request while a save is in flight', () => {
    assert.equal(resolveCloseIntent({ dirty: true, busy: true }), 'ignore');
    assert.equal(resolveCloseIntent({ dirty: false, busy: true }), 'ignore');
  });
});
