import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { shouldDismissOnKey, shouldDismissOnPointer } from './useDismissiblePanel';

describe('useDismissiblePanel dismissal rules', () => {
  it('dismisses on Escape only', () => {
    assert.equal(shouldDismissOnKey('Escape'), true);
    for (const key of ['Enter', ' ', 'Tab', 'ArrowDown', 'Esc']) {
      assert.equal(shouldDismissOnKey(key), false, key);
    }
  });

  it('dismisses a press outside both the panel and its trigger', () => {
    assert.equal(shouldDismissOnPointer({ insidePanel: false, insideTrigger: false }), true);
  });

  it('keeps the panel open while the user interacts inside it', () => {
    assert.equal(shouldDismissOnPointer({ insidePanel: true, insideTrigger: false }), false);
  });

  it('leaves a press on the trigger to the trigger, so it does not reopen', () => {
    assert.equal(shouldDismissOnPointer({ insidePanel: false, insideTrigger: true }), false);
    assert.equal(shouldDismissOnPointer({ insidePanel: true, insideTrigger: true }), false);
  });
});
