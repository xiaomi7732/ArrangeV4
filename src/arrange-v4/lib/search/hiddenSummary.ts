import { ALL_STATUSES, STATUS_LABELS, type TodoItem, type TodoStatus } from '../store/types';
import {
  filterTasks,
  passesTodayFilter,
  SHOW_ALL_STATUS_FILTERS,
  type TaskQuery,
} from './taskQuery';

export interface HiddenByStatusSummary {
  /** Items excluded only because of a status filter. */
  count: number;
  /** Statuses responsible, in canonical order. */
  statuses: TodoStatus[];
  /** Sentence fragment for the UI, or null when nothing is hidden this way. */
  label: string | null;
}

const EMPTY: HiddenByStatusSummary = { count: 0, statuses: [], label: null };

function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? '';
  if (labels.length === 2) return `${labels[0]} or ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`;
}

/**
 * Explains the gap between the result count and the total when the status
 * filters — not something the user typed — are what removed the items. The
 * default query hides cancelled work and all but today's finished work, so
 * without this the board reports missing items the user never filtered out.
 *
 * Scoped to the items the page has loaded, which is the same pool the
 * "Showing X of Y" count is drawn from: the calendar backend only fetches a
 * ±30-day window, and work outside it is not counted here either.
 */
export function summarizeHiddenByStatus(
  items: TodoItem[],
  query: TaskQuery,
  now?: Date,
): HiddenByStatusSummary {
  const restricted = ALL_STATUSES.filter(status => query.statusFilters[status] !== 'showAll');
  if (restricted.length === 0) return EMPTY;

  // Compare against the same query with every status shown, so items removed by
  // the text, tag or priority criteria are not miscounted as status-hidden.
  const candidates = filterTasks(
    items,
    { ...query, statusFilters: SHOW_ALL_STATUS_FILTERS },
    { now },
  );
  const hidden = candidates.filter(item => {
    const mode = query.statusFilters[item.status || 'new'];
    if (mode === 'hide') return true;
    return mode === 'todayOnly' && !passesTodayFilter(item, now ?? new Date());
  });
  const count = hidden.length;
  if (count === 0) return EMPTY;

  const hiddenStatuses = new Set<TodoStatus>(hidden.map(item => item.status || 'new'));
  const statuses = ALL_STATUSES.filter(status => hiddenStatuses.has(status));
  const noun = count === 1 ? 'item' : 'items';
  const labels = statuses.map(status => STATUS_LABELS[status].toLowerCase());

  return {
    count,
    statuses,
    label: labels.length > 0
      ? `${count} ${joinLabels(labels)} ${noun} hidden`
      : `${count} ${noun} hidden`,
  };
}
