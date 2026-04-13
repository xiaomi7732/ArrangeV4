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
export function formatRelativeDate(dateStr: string): string {
  const target = new Date(dateStr);
  const now = new Date();

  // Compare calendar days (strip time)
  const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const todayDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffMs = targetDay.getTime() - todayDay.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'tomorrow';
  if (diffDays === -1) return 'yesterday';
  if (diffDays > 1 && diffDays <= 14) return `in ${diffDays}d`;
  if (diffDays < -1 && diffDays >= -14) return `${Math.abs(diffDays)}d overdue`;

  return target.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
