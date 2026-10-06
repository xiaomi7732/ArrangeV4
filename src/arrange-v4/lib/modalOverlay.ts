export interface BackdropPress {
  /** The press (mousedown/touchstart) landed on the backdrop itself. */
  pressedOnBackdrop: boolean;
  /** The release (click) landed on the backdrop itself. */
  releasedOnBackdrop: boolean;
}

/**
 * Whether a backdrop click should dismiss a modal dialog.
 *
 * Both ends of the gesture have to be on the backdrop. A press that starts
 * inside the dialog — dragging to select text in the remarks box, say — often
 * releases outside it, and dismissing there would throw away the edits the
 * user was in the middle of reading or writing.
 */
export function shouldDismissOnBackdrop({
  pressedOnBackdrop,
  releasedOnBackdrop,
}: BackdropPress): boolean {
  return pressedOnBackdrop && releasedOnBackdrop;
}
