/**
 * Detecting unsaved edits so a dialog can ask before throwing them away.
 *
 * Closing an editor is a one-click, irreversible loss of whatever the user
 * typed, and the overlay click and Escape key make it easy to do by accident.
 * The confirmation is only worth showing when there is actually something to
 * lose, though — a prompt on every close trains the user to dismiss it without
 * reading, which is exactly how the real one gets missed.
 *
 * So the comparison has to be conservative in one direction: a false "dirty"
 * nags the user about work they never did, and is the worse failure.
 */

/**
 * Canonical form of a snapshot value.
 *
 * `undefined` and `null` both mean "not set" across the form state and the
 * stored item (an absent remark is `undefined` in one place and `null` in the
 * other), so they are folded together. Object keys are sorted because
 * insertion order is not a difference the user made.
 *
 * Strings are deliberately left verbatim: remarks are Markdown, where leading
 * whitespace is significant, so trimming here would call a real edit clean.
 */
export function normalizeSnapshotValue(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.map(normalizeSnapshotValue);
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      normalized[key] = normalizeSnapshotValue(source[key]);
    }
    return normalized;
  }
  return value;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  if (
    typeof a === 'object' && a !== null &&
    typeof b === 'object' && b !== null
  ) {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every(key =>
      Object.prototype.hasOwnProperty.call(right, key) && deepEqual(left[key], right[key]),
    );
  }
  // NaN never equals itself under ===, but an untouched numeric field should
  // not read as edited.
  return typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b);
}

export type FormSnapshot = Record<string, unknown>;

/**
 * Whether the form holds edits the user would lose.
 *
 * Both snapshots must describe the same fields: a key present in one and
 * missing from the other counts as a change, which is what makes a forgotten
 * field show up as a spurious prompt rather than silent data loss.
 */
export function hasUnsavedChanges(current: FormSnapshot, baseline: FormSnapshot): boolean {
  return !deepEqual(normalizeSnapshotValue(current), normalizeSnapshotValue(baseline));
}

export type CloseIntent = 'close' | 'confirm' | 'ignore';

/**
 * What a close request (Cancel, Escape, overlay click, or the X) should do.
 *
 * Kept separate from the hook so the rule itself can be tested: a request made
 * while a save is in flight is ignored rather than queued, because the write
 * that is already running decides the outcome, and closing underneath it would
 * leave the user looking at a board that disagrees with what they submitted.
 */
export function resolveCloseIntent(
  { dirty, busy }: { dirty: boolean; busy: boolean },
): CloseIntent {
  if (busy) return 'ignore';
  return dirty ? 'confirm' : 'close';
}
