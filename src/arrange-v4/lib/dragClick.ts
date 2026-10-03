/**
 * Tracks whether a click should be swallowed because it is the tail of a drag.
 *
 * The whole card is draggable, and a card is also clickable to open it. A
 * pointer sequence that ends a drag still fires a click on whatever was under
 * the pointer, so without this the card would open every time it was dropped.
 * Kept out of the component so the rule can be exercised directly.
 */
export interface ClickSuppressor {
  /** Call on pointer down: a new gesture starts with nothing to suppress. */
  notePointerDown(): void;
  /**
   * Call while a drag is in progress. Only a drag that began with a pointer
   * gesture arms the suppression: a keyboard drag ends on a key press, not on
   * a click, so arming it there would swallow an unrelated later click.
   */
  noteDragging(): void;
  /**
   * Call when the drag ends. The click that belongs to the drag may arrive
   * either side of this, so both orders have to be handled.
   */
  noteDragEnded(): void;
  /**
   * Whether the click that just happened belongs to a finished drag. Consumes
   * the flag, so only the one click that follows the drag is swallowed.
   */
  shouldSuppressClick(): boolean;
}

/**
 * How long after a drag ends a click still counts as that drag's tail. dnd-kit
 * installs its own capture-phase click eater on drag start and removes it
 * shortly after the drop, so the click often never reaches React at all and
 * the flag would otherwise stay armed until some unrelated later click.
 */
export const DRAG_CLICK_WINDOW_MS = 500;

export function createClickSuppressor(now: () => number = () => Date.now()): ClickSuppressor {
  let pointerGesture = false;
  let dragging = false;
  let endedAt: number | null = null;
  return {
    notePointerDown() {
      pointerGesture = true;
      dragging = false;
      endedAt = null;
    },
    noteDragging() {
      if (pointerGesture) dragging = true;
    },
    noteDragEnded() {
      if (dragging) endedAt = now();
      dragging = false;
    },
    shouldSuppressClick() {
      pointerGesture = false;
      if (dragging) {
        dragging = false;
        endedAt = null;
        return true;
      }
      if (endedAt === null) return false;
      const fresh = now() - endedAt <= DRAG_CLICK_WINDOW_MS;
      endedAt = null;
      return fresh;
    },
  };
}
