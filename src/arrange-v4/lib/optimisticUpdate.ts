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
