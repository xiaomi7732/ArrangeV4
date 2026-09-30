'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ALL_STATUSES, type TodoStatus } from '../store/types';
import {
  createDefaultTaskQuery,
  DEFAULT_STATUS_FILTERS,
  isQueryActive,
  taskQueriesEqual,
  type StatusFilterMode,
  type TaskQuery,
} from './taskQuery';
import {
  deletePreset as deleteStoredPreset,
  listPresets,
  renameCategoryInPresets,
  renamePreset as renameStoredPreset,
  savePreset as saveStoredPreset,
  type FilterPreset,
  type PresetScope,
} from './filterPresets';

export interface UseTaskQueryOptions {
  /** View-specific defaults, e.g. Cancelled shows every status. */
  defaultStatusFilters?: Record<TodoStatus, StatusFilterMode>;
  /**
   * Which pool of saved presets this view reads and writes. Views that expose
   * the same controls share a scope; a view with different controls needs its
   * own so presets can never carry criteria it cannot display or edit.
   */
  presetScope?: PresetScope;
}

export interface UseTaskQueryResult {
  query: TaskQuery;
  queryActive: boolean;
  setText: (text: string) => void;
  setStatusFilter: (status: TodoStatus, mode: StatusFilterMode) => void;
  resetStatusFilters: () => void;
  toggleCategory: (category: string) => void;
  toggleUncategorized: () => void;
  clearCategoryFilters: () => void;
  /** Mirrors a tag rename (or deletion, when `to` is null) into the live filters. */
  renameCategoryFilter: (from: string, to: string | null) => void;
  /**
   * Mirrors a committed tag rename (or deletion) into saved presets. Kept
   * separate from `renameCategoryFilter` so the persistent rewrite only happens
   * once the backend update has actually succeeded.
   */
  commitCategoryRenameToPresets: (from: string, to: string | null) => void;
  toggleUrgentOnly: () => void;
  toggleImportantOnly: () => void;
  clearAll: () => void;
  presets: FilterPreset[];
  activePresetId: string | null;
  /** The preset the user last applied or saved, even after editing its filters. */
  selectedPresetId: string | null;
  presetError: string | null;
  dismissPresetError: () => void;
  applyPreset: (presetId: string) => void;
  savePreset: (name: string) => boolean;
  renamePreset: (presetId: string, name: string) => boolean;
  deletePreset: (presetId: string) => void;
}

/**
 * Owns search/filter state plus saved presets for the selected book.
 *
 * Presets are read in an effect rather than during render because the app is
 * statically exported and `localStorage` is unavailable at prerender time.
 */
export function useTaskQuery(
  bookId: string | null | undefined,
  options: UseTaskQueryOptions = {},
): UseTaskQueryResult {
  const requestedDefaults = options.defaultStatusFilters ?? DEFAULT_STATUS_FILTERS;
  // Rebuild the defaults from a value key so callers may pass an inline object
  // without resetting the query on every render.
  const defaultsKey = ALL_STATUSES.map(status => requestedDefaults[status]).join('|');
  const defaultStatusFilters = useMemo(() => {
    const modes = defaultsKey.split('|') as StatusFilterMode[];
    const result = {} as Record<TodoStatus, StatusFilterMode>;
    ALL_STATUSES.forEach((status, index) => { result[status] = modes[index]; });
    return result;
  }, [defaultsKey]);

  const [query, setQuery] = useState<TaskQuery>(
    () => createDefaultTaskQuery(requestedDefaults),
  );
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  // An error is remembered together with the query it was raised for, so that
  // editing the search or filters clears a message that no longer applies. A
  // null query marks an error that is not tied to the live query.
  const [presetErrorState, setPresetErrorState] =
    useState<{ message: string; query: TaskQuery | null } | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);

  const scope: PresetScope = options.presetScope ?? 'board';

  // Reset the query when the selected book (or the view's defaults) changes, so
  // filters can never leak across books or storage backends. Adjusting state
  // during render is the documented alternative to a reset effect.
  const resetKey = `${bookId ?? ''}#${defaultsKey}`;
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  if (lastResetKey !== resetKey) {
    setLastResetKey(resetKey);
    setQuery(createDefaultTaskQuery(defaultStatusFilters));
    setPresetErrorState(null);
    setSelectedPresetId(null);
  }

  const presetError = presetErrorState && (presetErrorState.query === null || presetErrorState.query === query)
    ? presetErrorState.message
    : null;

  // Presets live in localStorage, which is unavailable during static prerender,
  // so they are loaded after mount rather than during render.
  useEffect(() => {
    setPresets(bookId ? listPresets(bookId, scope) : []); // eslint-disable-line react-hooks/set-state-in-effect -- reading localStorage is only safe after mount
  }, [bookId, scope]);

  // Tag updates resolve asynchronously; the handler that started one closes
  // over the book selected at that time. This ref tells the commit callback
  // which book is on screen now so a late completion cannot publish another
  // book's presets.
  const currentBookRef = useRef<string | null>(bookId ?? null);
  useEffect(() => {
    currentBookRef.current = bookId ?? null;
  }, [bookId]);

  // Prefer the preset the user actually chose. Two presets can hold identical
  // queries, so matching purely by value would let rename/delete act on the
  // wrong one.
  const activePresetId = useMemo(() => {
    const selected = presets.find(preset => preset.id === selectedPresetId);
    if (selected && taskQueriesEqual(selected.query, query)) return selected.id;
    const match = presets.find(preset => taskQueriesEqual(preset.query, query));
    return match ? match.id : null;
  }, [presets, query, selectedPresetId]);

  const queryActive = useMemo(
    () => isQueryActive(query, defaultStatusFilters),
    [query, defaultStatusFilters],
  );

  const setText = useCallback((text: string) => {
    setQuery(previous => ({ ...previous, text }));
  }, []);

  const setStatusFilter = useCallback((status: TodoStatus, mode: StatusFilterMode) => {
    setQuery(previous => ({
      ...previous,
      statusFilters: { ...previous.statusFilters, [status]: mode },
    }));
  }, []);

  const resetStatusFilters = useCallback(() => {
    setQuery(previous => ({
      ...previous,
      statusFilters: { ...defaultStatusFilters },
    }));
  }, [defaultStatusFilters]);

  const toggleCategory = useCallback((category: string) => {
    setQuery(previous => ({
      ...previous,
      categories: previous.categories.includes(category)
        ? previous.categories.filter(entry => entry !== category)
        : [...previous.categories, category],
    }));
  }, []);

  const toggleUncategorized = useCallback(() => {
    setQuery(previous => ({
      ...previous,
      includeUncategorized: !previous.includeUncategorized,
    }));
  }, []);

  const clearCategoryFilters = useCallback(() => {
    setQuery(previous => ({ ...previous, categories: [], includeUncategorized: false }));
  }, []);

  const renameCategoryFilter = useCallback((from: string, to: string | null) => {
    setQuery(previous => {
      if (!previous.categories.includes(from)) return previous;
      const remaining = previous.categories.filter(category => category !== from);
      return {
        ...previous,
        categories: to && !remaining.includes(to) ? [...remaining, to] : remaining,
      };
    });
  }, []);

  const commitCategoryRenameToPresets = useCallback((from: string, to: string | null) => {
    if (!bookId) return;
    const result = renameCategoryInPresets(bookId, scope, from, to);
    // The rewrite is persisted for `bookId` either way, but only publish it to
    // the UI while that book is still the one being shown.
    if (currentBookRef.current !== bookId) return;
    setPresets(result.presets);
    if (result.error) setPresetErrorState({ message: result.error, query: null });
  }, [bookId, scope]);

  const toggleUrgentOnly = useCallback(() => {
    setQuery(previous => ({ ...previous, urgentOnly: !previous.urgentOnly }));
  }, []);

  const toggleImportantOnly = useCallback(() => {
    setQuery(previous => ({ ...previous, importantOnly: !previous.importantOnly }));
  }, []);

  const clearAll = useCallback(() => {
    setQuery(createDefaultTaskQuery(defaultStatusFilters));
    setPresetErrorState(null);
    setSelectedPresetId(null);
  }, [defaultStatusFilters]);

  const dismissPresetError = useCallback(() => setPresetErrorState(null), []);

  const applyPreset = useCallback((presetId: string) => {
    const preset = presets.find(entry => entry.id === presetId);
    if (!preset) return;
    setPresetErrorState(null);
    setSelectedPresetId(presetId);
    setQuery(preset.query);
  }, [presets]);

  const savePreset = useCallback((name: string) => {
    if (!bookId) return false;
    // A preset identical to the view defaults would match every unfiltered
    // page load and show up as "applied" while filtering nothing.
    if (!queryActive) {
      setPresetErrorState({ message: 'Set a search or filter before saving it.', query });
      return false;
    }
    // The save target is the preset the user is looking at: whichever one the
    // bar shows as active, falling back to the one they applied and then
    // edited. Keeping this in step with `activePresetId` stops the prefilled
    // name from being rejected as belonging to "another" filter.
    const target = activePresetId ?? selectedPresetId;
    const result = saveStoredPreset(bookId, scope, name, query, target);
    setPresets(result.presets);
    setPresetErrorState(result.error ? { message: result.error, query } : null);
    if (result.preset) setSelectedPresetId(result.preset.id);
    return !result.error;
  }, [bookId, scope, query, queryActive, activePresetId, selectedPresetId]);

  const renamePreset = useCallback((presetId: string, name: string) => {
    if (!bookId) return false;
    const result = renameStoredPreset(bookId, scope, presetId, name);
    setPresets(result.presets);
    setPresetErrorState(result.error ? { message: result.error, query } : null);
    return !result.error;
  }, [bookId, scope, query]);

  const deletePreset = useCallback((presetId: string) => {
    if (!bookId) return;
    const result = deleteStoredPreset(bookId, scope, presetId);
    setPresets(result.presets);
    setPresetErrorState(result.error ? { message: result.error, query } : null);
    setSelectedPresetId(previous => (previous === presetId ? null : previous));
  }, [bookId, scope, query]);

  return {
    query,
    queryActive,
    setText,
    setStatusFilter,
    resetStatusFilters,
    toggleCategory,
    toggleUncategorized,
    clearCategoryFilters,
    renameCategoryFilter,
    commitCategoryRenameToPresets,
    toggleUrgentOnly,
    toggleImportantOnly,
    clearAll,
    presets,
    activePresetId,
    selectedPresetId,
    presetError,
    dismissPresetError,
    applyPreset,
    savePreset,
    renamePreset,
    deletePreset,
  };
}
