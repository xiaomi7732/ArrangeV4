import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { shouldDismissOnKey, shouldDismissOnPointer, selectDismissIndex } from './useDismissiblePanel';

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

describe('selectDismissIndex', () => {
  it('gives Escape to the panel the focused element is in', () => {
    // Both panels hear the key press; only the one being used may act, or the
    // other would close too and drag focus to its own trigger.
    assert.equal(selectDismissIndex([false, true]), 1);
    assert.equal(selectDismissIndex([true, false]), 0);
  });

  it('falls back to the most recently opened panel', () => {
    assert.equal(selectDismissIndex([false, false, false]), 2);
  });

  it('selects nothing when no panel is open', () => {
    assert.equal(selectDismissIndex([]), -1);
  });
});
