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
    suppressor.notePointerUp();
    assert.equal(suppressor.shouldSuppressClick(), false);
  });

  it('swallows the click that ends a drag', () => {
    const suppressor = createClickSuppressor();
    suppressor.notePointerDown();
    suppressor.noteDragging();
    suppressor.noteDragEnded();
    suppressor.notePointerUp();
    assert.equal(suppressor.shouldSuppressClick(), true);
  });

  it('swallows a click that arrives before the drag-end effect runs', () => {
    const suppressor = createClickSuppressor();
    suppressor.notePointerDown();
    suppressor.noteDragging();
    assert.equal(suppressor.shouldSuppressClick(), true);
  });

  it('swallows only the first click after a drag', () => {
    const suppressor = createClickSuppressor();
    suppressor.notePointerDown();
    suppressor.noteDragging();
    suppressor.noteDragEnded();
    suppressor.notePointerUp();
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
    suppressor.notePointerUp();
    assert.equal(suppressor.shouldSuppressClick(), true);
  });

  it('swallows the click when the drag was cancelled long before the release', () => {
    const clock = fakeClock();
    const suppressor = createClickSuppressor(clock.now);
    suppressor.notePointerDown();
    suppressor.noteDragging();
    // Escape cancels the drag, but the button is held down for a while after.
    suppressor.noteDragEnded();
    clock.advance(DRAG_CLICK_WINDOW_MS * 4);
    suppressor.notePointerUp();
    assert.equal(suppressor.shouldSuppressClick(), true);
  });

  it('forgets a drag whose click never arrived', () => {
    const clock = fakeClock();
    const suppressor = createClickSuppressor(clock.now);
    suppressor.notePointerDown();
    suppressor.noteDragging();
    suppressor.noteDragEnded();
    suppressor.notePointerUp();
    // dnd-kit ate the click itself; much later the user activates the card.
    clock.advance(DRAG_CLICK_WINDOW_MS + 1);
    assert.equal(suppressor.shouldSuppressClick(), false);
  });

  it('forgets an earlier drag when a new gesture starts', () => {
    const suppressor = createClickSuppressor();
    suppressor.notePointerDown();
    suppressor.noteDragging();
    suppressor.noteDragEnded();
    suppressor.notePointerUp();
    suppressor.notePointerDown();
    suppressor.notePointerUp();
    assert.equal(suppressor.shouldSuppressClick(), false);
  });

  it('keeps suppressing across repeated drags', () => {
    const suppressor = createClickSuppressor();
    for (let i = 0; i < 3; i += 1) {
      suppressor.notePointerDown();
      suppressor.noteDragging();
      suppressor.noteDragEnded();
      suppressor.notePointerUp();
      assert.equal(suppressor.shouldSuppressClick(), true);
    }
  });

  it('ignores a keyboard drag, which never ends in a click', () => {
    const suppressor = createClickSuppressor();
    suppressor.noteDragging();
    suppressor.noteDragEnded();
    assert.equal(suppressor.shouldSuppressClick(), false);
  });

  it('does not let an undelivered pointer-drag click arm a later keyboard drag', () => {
    const clock = fakeClock();
    const suppressor = createClickSuppressor(clock.now);
    // Pointer drag whose click dnd-kit ate, so it is never consumed here.
    suppressor.notePointerDown();
    suppressor.noteDragging();
    suppressor.noteDragEnded();
    suppressor.notePointerUp();
    clock.advance(DRAG_CLICK_WINDOW_MS + 1);
    // Keyboard drag some time later, then a keyboard activation on the card.
    suppressor.noteDragging();
    suppressor.noteDragEnded();
    assert.equal(suppressor.shouldSuppressClick(), false);
  });
});
