/**
 * Shared, backend-neutral task query model.
 *
 * Matrix, Scrum, and Cancelled all compose the same structured filters with
 * free-text search so results stay predictable across views. Everything here
 * is pure so it can be unit tested without React or a storage backend.
 */

import type { TodoItem, TodoStatus } from '../store/types';
import { ALL_STATUSES } from '../store/types';
import { isDateToday } from '../dateUtils';
import { markdownToSearchText } from '../markdown';

export type StatusFilterMode = 'showAll' | 'todayOnly' | 'hide';

export const FILTER_MODES: readonly StatusFilterMode[] = ['showAll', 'todayOnly', 'hide'];

export const FILTER_MODE_LABELS: Record<StatusFilterMode, string> = {
  showAll: 'All',
  todayOnly: 'Today',
  hide: 'Hide',
};

export const DEFAULT_STATUS_FILTERS: Record<TodoStatus, StatusFilterMode> = {
  new: 'showAll',
  inProgress: 'showAll',
  blocked: 'showAll',
  finished: 'todayOnly',
  cancelled: 'hide',
};

/** Status filters for views that intentionally scope to a single status (Cancelled). */
export const SHOW_ALL_STATUS_FILTERS: Record<TodoStatus, StatusFilterMode> = {
  new: 'showAll',
  inProgress: 'showAll',
  blocked: 'showAll',
  finished: 'showAll',
  cancelled: 'showAll',
};

export interface TaskQuery {
  /** Free-text search. Whitespace-separated terms are combined with AND. */
  text: string;
  statusFilters: Record<TodoStatus, StatusFilterMode>;
  /** Tags that an item must carry at least one of. */
  categories: string[];
  /** When true, items without any tag also satisfy the tag filter. */
  includeUncategorized: boolean;
  urgentOnly: boolean;
  importantOnly: boolean;
}

export function createDefaultTaskQuery(
  statusFilters: Record<TodoStatus, StatusFilterMode> = DEFAULT_STATUS_FILTERS,
): TaskQuery {
  return {
    text: '',
    statusFilters: { ...statusFilters },
    categories: [],
    includeUncategorized: false,
    urgentOnly: false,
    importantOnly: false,
  };
}

export function isStatusFilterActive(
  query: TaskQuery,
  defaults: Record<TodoStatus, StatusFilterMode> = DEFAULT_STATUS_FILTERS,
): boolean {
  return ALL_STATUSES.some(status => query.statusFilters[status] !== defaults[status]);
}

export function isCategoryFilterActive(query: TaskQuery): boolean {
  return query.categories.length > 0 || query.includeUncategorized;
}

export function isPriorityFilterActive(query: TaskQuery): boolean {
  return query.urgentOnly || query.importantOnly;
}

export function isTextFilterActive(query: TaskQuery): boolean {
  return searchTerms(query.text).length > 0;
}

/**
 * Whether any part of the query narrows results relative to `defaults`.
 * Drives the "Clear all" affordance and active-filter indicators.
 */
export function isQueryActive(
  query: TaskQuery,
  defaults: Record<TodoStatus, StatusFilterMode> = DEFAULT_STATUS_FILTERS,
): boolean {
  return isTextFilterActive(query)
    || isCategoryFilterActive(query)
    || isPriorityFilterActive(query)
    || isStatusFilterActive(query, defaults);
}

/** Splits raw search input into normalized AND terms. */
export function searchTerms(text: string): string[] {
  return text
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(term => term.length > 0);
}

/** Strips `-[x] ` / `-[] ` checklist markers so they never match search terms. */
export function checklistText(entry: string): string {
  return entry.replace(/^-\[[xX]?\]\s*/, '');
}

/** Lowercased searchable text for a task: title, tags, remarks, and checklist. */
export function taskSearchText(todo: TodoItem): string {
  const parts: string[] = [todo.subject || ''];

  if (todo.categories) parts.push(...todo.categories);
  if (todo.remarks?.content) {
    parts.push(
      todo.remarks.type === 'markdown'
        ? markdownToSearchText(todo.remarks.content)
        : todo.remarks.content,
    );
  }
  if (todo.checklist) {
    for (const entry of todo.checklist) parts.push(checklistText(entry));
  }

  return parts.join('\n').toLocaleLowerCase();
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

export function matchesSearchTerms(todo: TodoItem, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const haystack = taskSearchText(todo);
  return terms.every(term => haystack.includes(term));
}

/**
 * Compares two queries by effective meaning rather than by reference, so a
 * preset stays marked as applied while the user has not actually changed it.
 * Search terms are ANDed, so they are compared as a set: reordering or
 * repeating them cannot change which tasks match.
 */
export function taskQueriesEqual(a: TaskQuery, b: TaskQuery): boolean {
  if (!setsEqual(new Set(searchTerms(a.text)), new Set(searchTerms(b.text)))) return false;
  if (a.includeUncategorized !== b.includeUncategorized) return false;
  if (a.urgentOnly !== b.urgentOnly) return false;
  if (a.importantOnly !== b.importantOnly) return false;
  if (ALL_STATUSES.some(status => a.statusFilters[status] !== b.statusFilters[status])) {
    return false;
  }

  const aCategories = new Set(a.categories);
  const bCategories = new Set(b.categories);
  if (!setsEqual(aCategories, bCategories)) return false;
  return true;
}

export function passesTodayFilter(todo: TodoItem, now: Date = new Date()): boolean {
  const status = todo.status || 'new';
  if (status === 'finished') return isDateToday(todo.finishDateTime, now);
  return isDateToday(todo.etsDateTime, now);
}

export interface FilterTasksOptions {  /**
   * Views that already scope items to one status (Cancelled) opt out, so the
   * shared defaults — which hide cancelled items — cannot empty the page.
   */
  applyStatusFilters?: boolean;
  now?: Date;
}

export function filterTasks<T extends TodoItem>(
  items: T[],
  query: TaskQuery,
  options: FilterTasksOptions = {},
): T[] {
  const { applyStatusFilters = true, now } = options;
  const terms = searchTerms(query.text);
  const selectedCategories = new Set(query.categories);
  const categoryFilterActive = isCategoryFilterActive(query);

  return items.filter(todo => {
    if (applyStatusFilters) {
      const status = todo.status || 'new';
      const mode = query.statusFilters[status];
      if (mode === 'hide') return false;
      if (mode === 'todayOnly' && !passesTodayFilter(todo, now)) return false;
    }

    if (query.urgentOnly && todo.urgent !== true) return false;
    if (query.importantOnly && todo.important !== true) return false;

    if (categoryFilterActive) {
      const hasCategories = !!todo.categories && todo.categories.length > 0;
      const matchesCategory = hasCategories
        ? todo.categories!.some(category => selectedCategories.has(category))
        : query.includeUncategorized;
      if (!matchesCategory) return false;
    }

    return matchesSearchTerms(todo, terms);
  });
}
