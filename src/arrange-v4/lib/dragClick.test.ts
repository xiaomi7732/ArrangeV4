import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { createClickSuppressor } from './dragClick';

describe('createClickSuppressor', () => {
  it('lets a plain click through', () => {
    const suppressor = createClickSuppressor();
    suppressor.notePointerDown();
    assert.equal(suppressor.shouldSuppressClick(), false);
  });

  it('swallows the click that ends a drag', () => {
    const suppressor = createClickSuppressor();
    suppressor.notePointerDown();
    suppressor.noteDragging();
    assert.equal(suppressor.shouldSuppressClick(), true);
  });

  it('swallows only the first click after a drag', () => {
    const suppressor = createClickSuppressor();
    suppressor.notePointerDown();
    suppressor.noteDragging();
    assert.equal(suppressor.shouldSuppressClick(), true);
    assert.equal(suppressor.shouldSuppressClick(), false);
  });

  it('forgets an earlier drag when a new gesture starts', () => {
    const suppressor = createClickSuppressor();
    suppressor.notePointerDown();
    suppressor.noteDragging();
    // The drag ended without a click, e.g. dropped outside the card.
    suppressor.notePointerDown();
    assert.equal(suppressor.shouldSuppressClick(), false);
  });

  it('keeps suppressing across repeated drags', () => {
    const suppressor = createClickSuppressor();
    for (let i = 0; i < 3; i += 1) {
      suppressor.notePointerDown();
      suppressor.noteDragging();
      assert.equal(suppressor.shouldSuppressClick(), true);
    }
  });

  it('ignores a keyboard drag, which never ends in a click', () => {
    const suppressor = createClickSuppressor();
    suppressor.noteDragging();
    assert.equal(suppressor.shouldSuppressClick(), false);
  });

  it('does not let a keyboard drag swallow a later pointer click', () => {
    const suppressor = createClickSuppressor();
    suppressor.notePointerDown();
    assert.equal(suppressor.shouldSuppressClick(), false);
    // Keyboard drag: no pointer gesture of its own.
    suppressor.noteDragging();
    suppressor.notePointerDown();
    assert.equal(suppressor.shouldSuppressClick(), false);
  });
});
