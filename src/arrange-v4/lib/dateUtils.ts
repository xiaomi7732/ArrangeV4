/**
 * Which kind of instant a date represents. Only a deadline can be "overdue".
 */
export type RelativeDateKind = 'moment' | 'deadline';

/**
 * Result of formatting a date relative to today.
 */
export interface RelativeDateInfo {
  /** Display text, e.g. "in 3d", "2d ago", "2d overdue", "Jan 15" */
  text: string;
  /** True when the date is in the past */
  isOverdue: boolean;
  /** Full absolute date string for use in tooltips */
  fullDate: string;
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function localCalendarDay(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MILLISECONDS_PER_DAY;
}

export function differenceInLocalCalendarDays(target: Date, reference: Date): number {
  return localCalendarDay(target) - localCalendarDay(reference);
}

export function isDateToday(
  dateStr: string | undefined | null,
  now: Date = new Date(),
): boolean {
  if (!dateStr) return false;
  const target = new Date(dateStr);
  if (isNaN(target.getTime())) return false;
  return differenceInLocalCalendarDays(target, now) === 0;
}

/**
 * Absolute date and time for detail views and tooltips, e.g.
 * "Sep 30, 2026, 11:23 AM". One spelling everywhere so the same instant never
 * reads differently on two screens.
 */
export function formatAbsoluteDateTime(dateStr: string): string {
  const target = new Date(dateStr);
  if (isNaN(target.getTime())) return dateStr;
  return target.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Short absolute date without a time, e.g. "Sep 10". For dates that are not
 * deadlines, where relative phrasing like "20d overdue" would be wrong.
 */
export function formatShortDate(dateStr: string): string {
  const target = new Date(dateStr);
  if (isNaN(target.getTime())) return dateStr;
  return target.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Formats a date as a relative string when it's within ±14 days of now,
 * otherwise falls back to a short absolute date (e.g. "Jan 15").
 *
 * `kind` decides the wording for past dates. Only a deadline can be "overdue";
 * a planned start or an actual timestamp that has passed is simply in the past,
 * so it reads "2d ago".
 *
 * Examples:
 *   - "today"
 *   - "tomorrow"
 *   - "in 3d"
 *   - "yesterday"
 *   - "2d ago"        (kind: 'moment', the default)
 *   - "2d overdue"    (kind: 'deadline')
 *   - "Jan 15" (for dates further away)
 */
export function formatRelativeDate(
  dateStr: string,
  now: Date = new Date(),
  kind: RelativeDateKind = 'moment',
): RelativeDateInfo {
  const target = new Date(dateStr);

  if (isNaN(target.getTime())) {
    return { text: dateStr, isOverdue: false, fullDate: dateStr };
  }

  const fullDate = formatAbsoluteDateTime(dateStr);

  const diffDays = differenceInLocalCalendarDays(target, now);

  const isOverdue = diffDays < 0;

  if (diffDays === 0) return { text: 'today', isOverdue: false, fullDate };
  if (diffDays === 1) return { text: 'tomorrow', isOverdue: false, fullDate };
  if (diffDays === -1) return { text: 'yesterday', isOverdue: true, fullDate };
  if (diffDays > 1 && diffDays <= 14) return { text: `in ${diffDays}d`, isOverdue: false, fullDate };
  if (diffDays < -1 && diffDays >= -14) {
    const days = Math.abs(diffDays);
    return {
      text: kind === 'deadline' ? `${days}d overdue` : `${days}d ago`,
      isOverdue: true,
      fullDate,
    };
  }

  const text = target.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return { text, isOverdue, fullDate };
}
