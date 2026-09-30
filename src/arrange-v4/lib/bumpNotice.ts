import { formatAbsoluteDateTime, formatShortDate } from './dateUtils';
import { TodoItem } from './store/types';

export interface BumpNotice {
  /** Short inline text, e.g. "Sep 10 → Sep 11". */
  text: string;
  /** Explains both what the original dates were and why they moved. */
  tooltip: string;
}

/**
 * Describes an automatic date bump so it stops being invisible.
 *
 * Arrange moves stale non-terminal tasks forward to keep them inside the
 * calendar window it queries. The dates on the card are then the app's, not the
 * user's, and the originals are only meaningful if they are labelled as the
 * plan they came from.
 */
export function describeDateBump(
  todo: Pick<TodoItem, 'originalEtsDateTime' | 'originalEtaDateTime'>,
): BumpNotice | null {
  const originalEts = todo.originalEtsDateTime || null;
  const originalEta = todo.originalEtaDateTime || null;
  if (!originalEts && !originalEta) return null;

  // Deliberately absolute: these dates were superseded, not missed, so
  // relative phrasing such as "20d overdue" would misdescribe them.
  const text = [originalEts, originalEta]
    .filter((value): value is string => Boolean(value))
    .map(formatShortDate)
    .join(' → ');

  const absolute = [
    originalEts ? `ETS ${formatAbsoluteDateTime(originalEts)}` : null,
    originalEta ? `ETA ${formatAbsoluteDateTime(originalEta)}` : null,
  ].filter(Boolean).join(', ');

  return {
    text,
    tooltip: `Originally planned for ${absolute}. Arrange moved these dates forward so the task stays in view.`,
  };
}
