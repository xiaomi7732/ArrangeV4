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
 * would silently strip criteria from a board preset of the same name.
 */
export type PresetScope = 'board' | 'cancelled';

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

export function sanitizeTaskQuery(value: unknown): TaskQuery {
  const query = createDefaultTaskQuery();
  if (!value || typeof value !== 'object') return query;
  const source = value as Record<string, unknown>;

  return {
    text: typeof source.text === 'string' ? source.text : '',
    statusFilters: sanitizeStatusFilters(source.statusFilters),
    categories: sanitizeCategories(source.categories),
    includeUncategorized: source.includeUncategorized === true,
    urgentOnly: source.urgentOnly === true,
    importantOnly: source.importantOnly === true,
  };
}

function sanitizePreset(value: unknown): FilterPreset | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  if (typeof source.id !== 'string' || source.id.length === 0) return null;
  const name = typeof source.name === 'string' ? normalizePresetName(source.name) : '';
  if (!name) return null;
  return { id: source.id, name, query: sanitizeTaskQuery(source.query) };
}

export function listPresets(bookId: string | null | undefined, scope: PresetScope): FilterPreset[] {
  if (!bookId || !isLocalStorageAvailable()) return [];
  const key = presetStorageKey(bookId, scope);
  if (!key) return [];

  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const presets: FilterPreset[] = [];
    const seenIds = new Set<string>();
    for (const entry of parsed) {
      const preset = sanitizePreset(entry);
      if (!preset || seenIds.has(preset.id)) continue;
      seenIds.add(preset.id);
      presets.push(preset);
      if (presets.length >= MAX_PRESETS_PER_BOOK) break;
    }
    return presets;
  } catch {
    return [];
  }
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
 * Creates a preset, or overwrites the existing one with the same name so
 * repeated saves update in place rather than accumulating duplicates.
 */
export function savePreset(
  bookId: string,
  scope: PresetScope,
  name: string,
  query: TaskQuery,
): PresetMutationResult {
  const presets = listPresets(bookId, scope);
  const normalized = normalizePresetName(name);
  if (!normalized) return { presets, error: 'Enter a name for this filter.' };

  const sanitizedQuery = sanitizeTaskQuery(query);
  const existingIndex = presets.findIndex(
    preset => preset.name.toLocaleLowerCase() === normalized.toLocaleLowerCase(),
  );

  let next: FilterPreset[];
  let preset: FilterPreset;
  if (existingIndex >= 0) {
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
  const presets = listPresets(bookId, scope);
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
  const presets = listPresets(bookId, scope);
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
  const presets = listPresets(bookId, scope);
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
