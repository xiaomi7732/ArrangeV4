/**
 * Result of formatting a date relative to today.
 */
export interface RelativeDateInfo {
  /** Display text, e.g. "in 3d", "2d overdue", "Jan 15" */
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
 * Formats a date as a relative string when it's within ±14 days of now,
 * otherwise falls back to a short absolute date (e.g. "Jan 15").
 *
 * Examples:
 *   - "today"
 *   - "tomorrow"
 *   - "in 3d"
 *   - "yesterday"
 *   - "2d overdue"
 *   - "Jan 15" (for dates further away)
 */
export function formatRelativeDate(
  dateStr: string,
  now: Date = new Date(),
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
  if (diffDays < -1 && diffDays >= -14) return { text: `${Math.abs(diffDays)}d overdue`, isOverdue: true, fullDate };

  const text = target.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return { text, isOverdue, fullDate };
}
