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
  /** Call while a drag is in progress. */
  noteDragging(): void;
  /**
   * Whether the click that just happened belongs to a finished drag. Consumes
   * the flag, so only the one click that follows the drag is swallowed.
   */
  shouldSuppressClick(): boolean;
}

export function createClickSuppressor(): ClickSuppressor {
  let dragged = false;
  return {
    notePointerDown() {
      dragged = false;
    },
    noteDragging() {
      dragged = true;
    },
    shouldSuppressClick() {
      if (!dragged) return false;
      dragged = false;
      return true;
    },
  };
}
