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
 * Views that expose the same filter controls share presets. The boards
 * (Matrix and Scrum) offer status, tag, and priority filters; Cancelled is
 * search-only, so its presets are kept apart — otherwise a preset saved there
 * would silently strip criteria from a board preset of the same name. Timeline
 * is search-only over live tasks, which is neither of the other two.
 */
export type PresetScope = 'board' | 'cancelled' | 'timeline';

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

  // Cancelled and Timeline are search-only: they render no tag or priority
  // controls, so a preset carrying those criteria (hand-edited storage, or
  // written by an older release) would filter by something the user cannot
  // see or clear.
  if (scope === 'cancelled' || scope === 'timeline') {
    return {
      ...query,
      text: typeof source.text === 'string' ? source.text : '',
      statusFilters: sanitizeStatusFilters(source.statusFilters),
    };
  }

  return {
    text: typeof source.text === 'string' ? source.text : '',
    statusFilters: sanitizeStatusFilters(source.statusFilters),
    categories: sanitizeCategories(source.categories),
    includeUncategorized: source.includeUncategorized === true,
    urgentOnly: source.urgentOnly === true,
    importantOnly: source.importantOnly === true,
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
  if (!raw) return { presets: [], failed: false };

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
 */
export function renameCategoryInPresets(
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
