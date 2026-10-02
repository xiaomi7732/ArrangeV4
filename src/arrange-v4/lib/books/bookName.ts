/**
 * Pure validation for the Create Book form.
 *
 * Note: this module is compiled by tsconfig.test.json, which does not rewrite
 * the "@/" path alias, so imports here must stay relative.
 */

const ARRANGE_SUFFIX_REGEX = / by arrange$/i;

export interface BookNameValidationOk {
  ok: true;
  /** Trimmed name with any user-typed " by arrange" suffix removed. */
  name: string;
}

export interface BookNameValidationError {
  ok: false;
  error: string;
}

export type BookNameValidation = BookNameValidationOk | BookNameValidationError;

/** Collapses internal whitespace runs so "a  b" and "a b" compare equal. */
function canonicalize(name: string, stripArrangeSuffix: boolean): string {
  return normalize(name, stripArrangeSuffix)
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function normalize(name: string, stripArrangeSuffix: boolean): string {
  // Strip before trimming: trimming first removes the leading space, after
  // which " by arrange" no longer matches and "by arrange" survives as a name.
  const withoutSuffix = stripArrangeSuffix
    ? name.trimEnd().replace(ARRANGE_SUFFIX_REGEX, '')
    : name;
  return withoutSuffix.trim();
}

export interface BookNameOptions {
  /**
   * Whether the backend appends " by arrange" itself. Only then should a
   * user-typed suffix be removed — a Sheets book may legitimately be named
   * "Team by arrange".
   */
  stripArrangeSuffix?: boolean;
}

export function validateBookName(
  rawName: string,
  existingNames: readonly string[],
  { stripArrangeSuffix = true }: BookNameOptions = {},
): BookNameValidation {
  const trimmed = normalize(rawName, stripArrangeSuffix);

  if (!trimmed) {
    return { ok: false, error: 'Book name is required' };
  }

  const candidate = canonicalize(rawName, stripArrangeSuffix);
  const clash = existingNames.find(
    existing => canonicalize(existing, stripArrangeSuffix) === candidate,
  );
  if (clash !== undefined) {
    return { ok: false, error: `A book named "${clash.trim()}" already exists` };
  }

  return { ok: true, name: trimmed };
}
