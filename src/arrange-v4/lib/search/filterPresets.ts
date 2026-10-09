/**
 * Named filter presets, scoped per storage backend, book, and view scope.
 *
 * Presets are a client-side convenience only: they live in localStorage and
 * never touch Calendar or Sheets persistence schemas. Stored values are
 * untrusted (another tab, an older release, or a user editing storage), so
 * everything read back is validated before use.
 */

import { ALL_STATUSES, parseBookId, type TodoStatus } from '../store/types';
import {
  createDefaultTaskQuery,
  DEFAULT_STATUS_FILTERS,
  FILTER_MODES,
  type StatusFilterMode,
  type TaskQuery,
} from './taskQuery';

const PRESET_KEY_PREFIX = 'arrange_filterPresets';

/**
 * Views that expose the same filter controls share presets. A view with
 * different controls needs its own scope, so a preset can never carry criteria
 * that view cannot display or edit: applying it would filter the board by
 * something invisible with no way to clear it.
 *
 * - `board`   — Scrum: status, tag, and priority filters.
 * - `matrix`  — Matrix: status and tag filters. The quadrants already separate
 *               urgent from important, so filtering on them there is
 *               meaningless.
 * - `cancelled`, `timeline` — search-only views.
 */
export type PresetScope = 'board' | 'matrix' | 'cancelled' | 'timeline';

/**
 * Which criteria each scope can actually show. One table drives both the
 * sanitising of stored presets and the controls a page renders, so the two can
 * never disagree about what a view supports.
 */
export interface ScopeCapabilities {
  /** Tag filters: specific categories plus "uncategorized". */
  categories: boolean;
  /** Urgent-only / important-only toggles. */
  priority: boolean;
}

export const SCOPE_CAPABILITIES: Record<PresetScope, ScopeCapabilities> = {
  board: { categories: true, priority: true },
  matrix: { categories: true, priority: false },
  cancelled: { categories: false, priority: false },
  timeline: { categories: false, priority: false },
};

export const PRESET_SCOPES = Object.keys(SCOPE_CAPABILITIES) as PresetScope[];

export function capabilitiesForScope(scope: PresetScope): ScopeCapabilities {
  return SCOPE_CAPABILITIES[scope] ?? SCOPE_CAPABILITIES.board;
}

export const MAX_PRESET_NAME_LENGTH = 60;
export const MAX_PRESETS_PER_BOOK = 50;

export interface FilterPreset {
  id: string;
  name: string;
  query: TaskQuery;
}

function isLocalStorageAvailable(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
}

/**
 * Storage key for a book within a view scope. Includes the backend so a
 * Calendar book and a Sheets book can never read each other's presets.
 */
export function presetStorageKey(bookId: string, scope: PresetScope): string | null {
  const parsed = parseBookId(bookId);
  if (!parsed) return null;
  return `${PRESET_KEY_PREFIX}_${parsed.backend}_${parsed.nativeId}_${scope}`;
}

export function normalizePresetName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, MAX_PRESET_NAME_LENGTH);
}

function isStatusFilterMode(value: unknown): value is StatusFilterMode {
  return typeof value === 'string'
    && (FILTER_MODES as readonly string[]).includes(value);
}

function sanitizeStatusFilters(value: unknown): Record<TodoStatus, StatusFilterMode> {
  const filters = { ...DEFAULT_STATUS_FILTERS };
  if (!value || typeof value !== 'object') return filters;
  const source = value as Record<string, unknown>;
  for (const status of ALL_STATUSES) {
    const mode = source[status];
    if (isStatusFilterMode(mode)) filters[status] = mode;
  }
  return filters;
}

function sanitizeCategories(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const entry of value) {
    if (typeof entry === 'string' && entry.length > 0) unique.add(entry);
  }
  return [...unique];
}

export function sanitizeTaskQuery(value: unknown, scope: PresetScope = 'board'): TaskQuery {
  const query = createDefaultTaskQuery();
  if (!value || typeof value !== 'object') return query;
  const source = value as Record<string, unknown>;

  // Criteria a scope cannot render are dropped rather than kept: a preset
  // carrying them (hand-edited storage, an older release, or a view that has
  // since lost a control) would filter by something the user cannot see or
  // clear.
  const capabilities = capabilitiesForScope(scope);

  return {
    text: typeof source.text === 'string' ? source.text : '',
    statusFilters: sanitizeStatusFilters(source.statusFilters),
    categories: capabilities.categories ? sanitizeCategories(source.categories) : [],
    includeUncategorized: capabilities.categories && source.includeUncategorized === true,
    urgentOnly: capabilities.priority && source.urgentOnly === true,
    importantOnly: capabilities.priority && source.importantOnly === true,
  };
}

function sanitizePreset(value: unknown, scope: PresetScope): FilterPreset | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  if (typeof source.id !== 'string' || source.id.length === 0) return null;
  const name = typeof source.name === 'string' ? normalizePresetName(source.name) : '';
  if (!name) return null;
  return { id: source.id, name, query: sanitizeTaskQuery(source.query, scope) };
}

interface PresetReadResult {
  presets: FilterPreset[];
  /** True only when storage itself is unreadable, never for corrupt contents. */
  failed: boolean;
}

const READ_FAILURE_MESSAGE = 'Could not read saved filters from browser storage.';

/**
 * Marks that Matrix has inherited the boards' presets. Without it, deleting
 * every Matrix preset clears the key and the next read would resurrect them.
 */
function matrixMigrationKey(bookId: string): string | null {
  const key = presetStorageKey(bookId, 'matrix');
  return key ? `${key}_migrated` : null;
}

function hasInheritedBoardPresets(bookId: string): boolean {
  const key = matrixMigrationKey(bookId);
  if (!key) return true;
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return true;
  }
}

function markBoardPresetsInherited(bookId: string): boolean {
  const key = matrixMigrationKey(bookId);
  if (!key) return false;
  try {
    localStorage.setItem(key, 'true');
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads presets, distinguishing "storage is unreadable" from "nothing saved".
 * Mutations must not report success when they never saw the stored list.
 * Corrupt or unparseable contents are *not* a failure: overwriting them is the
 * recovery path.
 */
function readPresets(bookId: string, scope: PresetScope): PresetReadResult {
  if (!isLocalStorageAvailable()) return { presets: [], failed: true };
  const key = presetStorageKey(bookId, scope);
  if (!key) return { presets: [], failed: true };

  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return { presets: [], failed: true };
  }
  if (!raw) {
    // Matrix used to share the boards' presets. The first time it reads its
    // own pool, it inherits them with the priority criteria it cannot show
    // stripped out, so saved filters do not appear to vanish.
    if (scope === 'matrix' && !hasInheritedBoardPresets(bookId)) {
      const inherited = readPresets(bookId, 'board');
      if (inherited.failed) return { presets: [], failed: true };
      const migrated = inherited.presets.map(preset => ({
        ...preset,
        query: sanitizeTaskQuery(preset.query, 'matrix'),
      }));
      // Only a completed copy may be marked done: marking a failed write would
      // show the inherited presets once and then lose them for good.
      if (migrated.length > 0 && !writePresets(bookId, 'matrix', migrated)) {
        return { presets: migrated, failed: true };
      }
      markBoardPresetsInherited(bookId);
      return { presets: migrated, failed: false };
    }
    return { presets: [], failed: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { presets: [], failed: false };
  }
  if (!Array.isArray(parsed)) return { presets: [], failed: false };

  const presets: FilterPreset[] = [];
  const seenIds = new Set<string>();
  for (const entry of parsed) {
    const preset = sanitizePreset(entry, scope);
    if (!preset || seenIds.has(preset.id)) continue;
    seenIds.add(preset.id);
    presets.push(preset);
    if (presets.length >= MAX_PRESETS_PER_BOOK) break;
  }
  return { presets, failed: false };
}

export function listPresets(bookId: string | null | undefined, scope: PresetScope): FilterPreset[] {
  if (!bookId) return [];
  return readPresets(bookId, scope).presets;
}

/** Persists presets. Returns false when storage is unavailable or full. */
function writePresets(bookId: string, scope: PresetScope, presets: FilterPreset[]): boolean {
  if (!isLocalStorageAvailable()) return false;
  const key = presetStorageKey(bookId, scope);
  if (!key) return false;

  try {
    if (presets.length === 0) {
      // Clearing the key makes the next read look like a first visit, so the
      // marker has to be in place before the list goes: otherwise deleting the
      // last Matrix preset resurrects the inherited board ones.
      if (scope === 'matrix' && !markBoardPresetsInherited(bookId)) return false;
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(presets));
    }
    return true;
  } catch {
    return false;
  }
}

function newPresetId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the timestamp-based ID below.
  }
  return `preset-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface PresetMutationResult {
  presets: FilterPreset[];
  preset?: FilterPreset;
  error?: string;
}

/**
 * Creates a preset, or updates the currently-selected one in place when the
 * name is unchanged. A name that belongs to a *different* preset is rejected
 * rather than silently overwritten, matching `renamePreset` and keeping a
 * mistyped name from destroying an unrelated saved filter.
 */
export function savePreset(
  bookId: string,
  scope: PresetScope,
  name: string,
  query: TaskQuery,
  activePresetId?: string | null,
): PresetMutationResult {
  const { presets, failed } = readPresets(bookId, scope);
  if (failed) return { presets, error: READ_FAILURE_MESSAGE };
  const normalized = normalizePresetName(name);
  if (!normalized) return { presets, error: 'Enter a name for this filter.' };

  const sanitizedQuery = sanitizeTaskQuery(query, scope);
  const existingIndex = presets.findIndex(
    preset => preset.name.toLocaleLowerCase() === normalized.toLocaleLowerCase(),
  );

  let next: FilterPreset[];
  let preset: FilterPreset;
  if (existingIndex >= 0) {
    if (presets[existingIndex].id !== activePresetId) {
      return { presets, error: 'Another filter already uses that name.' };
    }
    preset = { ...presets[existingIndex], name: normalized, query: sanitizedQuery };
    next = [...presets];
    next[existingIndex] = preset;
  } else {
    if (presets.length >= MAX_PRESETS_PER_BOOK) {
      return { presets, error: `You can save up to ${MAX_PRESETS_PER_BOOK} filters per book.` };
    }
    preset = { id: newPresetId(), name: normalized, query: sanitizedQuery };
    next = [...presets, preset];
  }

  if (!writePresets(bookId, scope, next)) {
    return { presets, error: 'Could not save this filter in browser storage.' };
  }
  return { presets: next, preset };
}

export function renamePreset(
  bookId: string,
  scope: PresetScope,
  presetId: string,
  name: string,
): PresetMutationResult {
  const { presets, failed } = readPresets(bookId, scope);
  if (failed) return { presets, error: READ_FAILURE_MESSAGE };
  const normalized = normalizePresetName(name);
  if (!normalized) return { presets, error: 'Enter a name for this filter.' };

  const index = presets.findIndex(preset => preset.id === presetId);
  if (index < 0) return { presets, error: 'That filter no longer exists.' };

  const duplicate = presets.some(
    (preset, i) => i !== index
      && preset.name.toLocaleLowerCase() === normalized.toLocaleLowerCase(),
  );
  if (duplicate) return { presets, error: 'Another filter already uses that name.' };

  const preset = { ...presets[index], name: normalized };
  const next = [...presets];
  next[index] = preset;

  if (!writePresets(bookId, scope, next)) {
    return { presets, error: 'Could not rename this filter in browser storage.' };
  }
  return { presets: next, preset };
}

export function deletePreset(bookId: string, scope: PresetScope, presetId: string): PresetMutationResult {
  const { presets, failed } = readPresets(bookId, scope);
  if (failed) return { presets, error: READ_FAILURE_MESSAGE };
  const next = presets.filter(preset => preset.id !== presetId);
  if (next.length === presets.length) return { presets };

  if (!writePresets(bookId, scope, next)) {
    return { presets, error: 'Could not delete this filter from browser storage.' };
  }
  return { presets: next };
}

/**
 * Keeps saved presets consistent with tag management. Renaming a tag rewrites
 * it in every preset; deleting a tag (`to === null`) drops it. Without this a
 * preset would keep filtering on a tag that no longer exists and match nothing.
 *
 * A tag belongs to the book, not to one view, so the rewrite runs over every
 * scope that can hold tags — otherwise renaming from Matrix would leave Scrum's
 * presets pointing at a tag that no longer exists.
 */
export function renameCategoryInPresets(
  bookId: string,
  scope: PresetScope,
  from: string,
  to: string | null,
): PresetMutationResult {
  const scopes: PresetScope[] = [
    scope,
    ...PRESET_SCOPES.filter(other => other !== scope && SCOPE_CAPABILITIES[other].categories),
  ];

  let own: PresetMutationResult = { presets: [] };
  let otherScopeError: string | undefined;
  for (const target of scopes) {
    const outcome = rewriteCategoryInScope(bookId, target, from, to);
    // Only the caller's own scope decides what it gets back, but a failure in
    // any scope has to be reported: those presets still hold the old tag.
    if (target === scope) own = outcome;
    else if (outcome.error && !otherScopeError) otherScopeError = outcome.error;
  }
  if (own.error || !otherScopeError) return own;
  return { ...own, error: otherScopeError };
}

function rewriteCategoryInScope(
  bookId: string,
  scope: PresetScope,
  from: string,
  to: string | null,
): PresetMutationResult {
  const { presets, failed } = readPresets(bookId, scope);
  if (failed) {
    return { presets, error: 'Saved filters still reference the old tag: browser storage is unavailable.' };
  }
  let changed = false;

  const next = presets.map(preset => {
    if (!preset.query.categories.includes(from)) return preset;
    changed = true;
    const remaining = preset.query.categories.filter(category => category !== from);
    const categories = to && !remaining.includes(to) ? [...remaining, to] : remaining;
    return { ...preset, query: { ...preset.query, categories } };
  });

  if (!changed) return { presets };
  if (!writePresets(bookId, scope, next)) {
    return { presets, error: 'Saved filters still reference the old tag: browser storage is unavailable.' };
  }
  return { presets: next };
}
