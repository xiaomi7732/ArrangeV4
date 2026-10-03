import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { createClickSuppressor, DRAG_CLICK_WINDOW_MS } from './dragClick';

function fakeClock() {
  let value = 1000;
  return {
    now: () => value,
    advance: (ms: number) => { value += ms; },
  };
}

describe('createClickSuppressor', () => {
  it('lets a plain click through', () => {
    const suppressor = createClickSuppressor();
    suppressor.notePointerDown();
    assert.equal(suppressor.shouldSuppressClick(), false);
  });

  it('swallows the click that ends a drag, whichever order it arrives in', () => {
    const beforeEnd = createClickSuppressor();
    beforeEnd.notePointerDown();
    beforeEnd.noteDragging();
    assert.equal(beforeEnd.shouldSuppressClick(), true);

    const afterEnd = createClickSuppressor();
    afterEnd.notePointerDown();
    afterEnd.noteDragging();
    afterEnd.noteDragEnded();
    assert.equal(afterEnd.shouldSuppressClick(), true);
  });

  it('swallows only the first click after a drag', () => {
    const suppressor = createClickSuppressor();
    suppressor.notePointerDown();
    suppressor.noteDragging();
    suppressor.noteDragEnded();
    assert.equal(suppressor.shouldSuppressClick(), true);
    assert.equal(suppressor.shouldSuppressClick(), false);
  });

  it('still swallows the click after a long drag', () => {
    const clock = fakeClock();
    const suppressor = createClickSuppressor(clock.now);
    suppressor.notePointerDown();
    suppressor.noteDragging();
    clock.advance(30_000);
    suppressor.noteDragEnded();
    assert.equal(suppressor.shouldSuppressClick(), true);
  });

  it('forgets a drag whose click never arrived', () => {
    const clock = fakeClock();
    const suppressor = createClickSuppressor(clock.now);
    suppressor.notePointerDown();
    suppressor.noteDragging();
    suppressor.noteDragEnded();
    // dnd-kit ate the click itself; much later the user activates the card.
    clock.advance(DRAG_CLICK_WINDOW_MS + 1);
    assert.equal(suppressor.shouldSuppressClick(), false);
  });

  it('forgets an earlier drag when a new gesture starts', () => {
    const suppressor = createClickSuppressor();
    suppressor.notePointerDown();
    suppressor.noteDragging();
    suppressor.noteDragEnded();
    suppressor.notePointerDown();
    assert.equal(suppressor.shouldSuppressClick(), false);
  });

  it('keeps suppressing across repeated drags', () => {
    const suppressor = createClickSuppressor();
    for (let i = 0; i < 3; i += 1) {
      suppressor.notePointerDown();
      suppressor.noteDragging();
      suppressor.noteDragEnded();
      assert.equal(suppressor.shouldSuppressClick(), true);
    }
  });

  it('ignores a keyboard drag, which never ends in a click', () => {
    const suppressor = createClickSuppressor();
    suppressor.noteDragging();
    suppressor.noteDragEnded();
    assert.equal(suppressor.shouldSuppressClick(), false);
  });

  it('does not let a keyboard drag swallow a later pointer click', () => {
    const suppressor = createClickSuppressor();
    suppressor.notePointerDown();
    assert.equal(suppressor.shouldSuppressClick(), false);
    suppressor.noteDragging();
    suppressor.noteDragEnded();
    suppressor.notePointerDown();
    assert.equal(suppressor.shouldSuppressClick(), false);
  });
});

