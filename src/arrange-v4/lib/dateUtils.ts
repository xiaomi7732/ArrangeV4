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
export function formatRelativeDate(dateStr: string): RelativeDateInfo {
  const target = new Date(dateStr);

  if (isNaN(target.getTime())) {
    return { text: dateStr, isOverdue: false, fullDate: dateStr };
  }

  const now = new Date();
  const fullDate = target.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' });

  // Compare calendar days (strip time)
  const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const todayDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffMs = targetDay.getTime() - todayDay.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  const isOverdue = diffDays < 0;

  if (diffDays === 0) return { text: 'today', isOverdue: false, fullDate };
  if (diffDays === 1) return { text: 'tomorrow', isOverdue: false, fullDate };
  if (diffDays === -1) return { text: 'yesterday', isOverdue: true, fullDate };
  if (diffDays > 1 && diffDays <= 14) return { text: `in ${diffDays}d`, isOverdue: false, fullDate };
  if (diffDays < -1 && diffDays >= -14) return { text: `${Math.abs(diffDays)}d overdue`, isOverdue: true, fullDate };

  const text = target.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return { text, isOverdue, fullDate };
}
