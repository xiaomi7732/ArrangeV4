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
function canonicalize(name: string): string {
  return name
    .trimEnd()
    .replace(ARRANGE_SUFFIX_REGEX, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function validateBookName(
  rawName: string,
  existingNames: readonly string[],
): BookNameValidation {
  const trimmed = rawName.trimEnd().replace(ARRANGE_SUFFIX_REGEX, '').trim();

  if (!trimmed) {
    return { ok: false, error: 'Book name is required' };
  }

  const candidate = canonicalize(rawName);
  const clash = existingNames.find(existing => canonicalize(existing) === candidate);
  if (clash !== undefined) {
    return { ok: false, error: `A book named "${clash.trim()}" already exists` };
  }

  return { ok: true, name: trimmed };
}
