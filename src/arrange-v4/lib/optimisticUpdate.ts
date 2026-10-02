/**
 * Helpers for undoing an optimistic update when the backend write fails.
 *
 * Optimistic UI is only honest if a rejected write is taken back: otherwise the
 * board keeps showing a change that was never persisted, and the user finds out
 * only on the next refresh.
 */

export interface Identified {
  id: string;
}

/** Pre-mutation copies of the items a mutation is about to touch. */
export function snapshotItems<T extends Identified>(
  items: readonly T[],
  ids: Iterable<string>,
): T[] {
  const wanted = new Set(ids);
  if (wanted.size === 0) return [];
  return items.filter(item => wanted.has(item.id));
}

/**
 * Puts the snapshotted copies back. Items missing from the snapshot are left
 * alone, and items that have since been removed are not resurrected, so a
 * rollback can never invent or duplicate rows.
 *
 * Returns the original array when nothing changed, so callers can keep their
 * state identity stable and skip a re-render.
 */
export function restoreSnapshot<T extends Identified>(
  items: readonly T[],
  snapshot: readonly T[],
): T[] {
  if (snapshot.length === 0) return items as T[];
  const restored = new Map(snapshot.map(item => [item.id, item]));
  let changed = false;
  const next = items.map(item => {
    const original = restored.get(item.id);
    if (!original || original === item) return item;
    changed = true;
    return original;
  });
  return changed ? next : (items as T[]);
}

/**
 * Drops updates aimed at items whose stored data could not be read.
 *
 * The stores refuse to write such an item, because merging into a payload they
 * could not parse would destroy whatever is still in it. A batch reorder would
 * otherwise fail as a whole and take the rest of the lane with it, so one
 * damaged event makes every drag in its quadrant fail until it is repaired by
 * hand. Skipping just that item leaves its stored order where it was.
 */
export function dropUnwritableUpdates<U>(
  updates: ReadonlyMap<string, U>,
  items: readonly { id: string; dataUnreadable?: boolean }[],
): Map<string, U> {
  const unwritable = new Set(
    items.filter(item => item.dataUnreadable).map(item => item.id),
  );
  if (unwritable.size === 0) return new Map(updates);
  return new Map([...updates].filter(([id]) => !unwritable.has(id)));
}

/**
 * Splits items into those a store will accept a write for and those it will
 * refuse because their stored data could not be read.
 *
 * A bulk tag rename spans whatever items carry the tag, so a single damaged
 * one would otherwise reject the whole batch and leave the tag unchanged
 * everywhere. Renaming the items that can be written, and saying plainly which
 * were left alone, is the honest outcome.
 */
export function partitionWritableItems<T extends { dataUnreadable?: boolean }>(
  items: readonly T[],
): { writable: T[]; skipped: T[] } {
  const writable: T[] = [];
  const skipped: T[] = [];
  for (const item of items) {
    if (item.dataUnreadable) skipped.push(item);
    else writable.push(item);
  }
  return { writable, skipped };
}

/** Explains which items a bulk tag change could not touch, or null when all were written. */
export function describeSkippedUnwritable(count: number): string | null {
  if (count <= 0) return null;
  const subject = count === 1 ? '1 item' : `${count} items`;
  return `${subject} kept the old tag because the saved data could not be read. `
    + 'Open those events in Outlook to repair or clear their description, then retry.';
}
