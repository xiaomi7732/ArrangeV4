import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldDismissOnBackdrop } from './modalOverlay';

test('dismisses when the whole press happened on the backdrop', () => {
  assert.equal(
    shouldDismissOnBackdrop({ pressedOnBackdrop: true, releasedOnBackdrop: true }),
    true,
  );
});

test('keeps the dialog when the press started inside it', () => {
  assert.equal(
    shouldDismissOnBackdrop({ pressedOnBackdrop: false, releasedOnBackdrop: true }),
    false,
  );
});

test('keeps the dialog when the release landed inside it', () => {
  assert.equal(
    shouldDismissOnBackdrop({ pressedOnBackdrop: true, releasedOnBackdrop: false }),
    false,
  );
});

test('keeps the dialog when neither end touched the backdrop', () => {
  assert.equal(
    shouldDismissOnBackdrop({ pressedOnBackdrop: false, releasedOnBackdrop: false }),
    false,
  );
});
