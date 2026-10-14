/**
 * Whether a view should replace its content with a loading placeholder.
 *
 * Only a load with nothing to show yet earns the placeholder — a first load,
 * or a switch to a book whose items are not in hand. A background refresh of
 * the book already on screen keeps the content mounted, because unmounting it
 * tears down whatever is open over it: an Add dialog loses a half-written
 * task, which is exactly what a refresh the user never asked for must not do.
 */
export function shouldShowLoadingPlaceholder({
  loading,
  bookId,
  itemsBookId,
}: {
  loading: boolean;
  bookId: string | null;
  itemsBookId: string | null;
}): boolean {
  return loading && itemsBookId !== bookId;
}
