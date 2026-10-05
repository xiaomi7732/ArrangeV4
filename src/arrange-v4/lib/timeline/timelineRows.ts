import type { TodoItemWithId } from '../store/types';
import { STATUS_LABELS } from '../store/types';
import { formatAbsoluteDateTime } from '../dateUtils';
import { type TimelineWindow, barGeometry } from './timelineWindow';

export interface TimelineRow {
  item: TodoItemWithId;
  /** Distance from the left edge of the chart, in percent. */
  left: number;
  width: number;
  clippedStart: boolean;
  clippedEnd: boolean;
  tooltip: string;
}
function toMs(value: string | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Turns tasks into the bars the chart draws.
 *
 * A task without a usable date, or one that falls entirely outside the window,
 * yields no row at all — which is also why the caller counts rows rather than
 * items when it reports how many tasks the period holds.
 */
export function buildTimelineRows(
  items: TodoItemWithId[],
  window: TimelineWindow,
): TimelineRow[] {
  const rows: { row: TimelineRow; startMs: number }[] = [];
  for (const item of items) {
    const startMs = toMs(item.etsDateTime);
    const endMs = toMs(item.etaDateTime);
    const geometry = barGeometry(startMs, endMs, window);
    if (!geometry) continue;
    const parts: string[] = [item.subject, STATUS_LABELS[item.status || 'new']];
    if (item.etsDateTime) parts.push(`ETS: ${formatAbsoluteDateTime(item.etsDateTime)}`);
    if (item.etaDateTime) parts.push(`ETA: ${formatAbsoluteDateTime(item.etaDateTime)}`);
    rows.push({
      startMs: Math.min(startMs ?? endMs ?? 0, endMs ?? startMs ?? 0),
      row: {
        item,
        left: geometry.leftPercent,
        width: geometry.widthPercent,
        clippedStart: geometry.clippedStart,
        clippedEnd: geometry.clippedEnd,
        tooltip: parts.join('\n'),
      },
    });
  }
  /*
   * Earliest first, so reading down the chart reads forward in time — and
   * ordered by the real start rather than the clipped one, because every bar
   * running off the left edge shares a position of 0%. Sorting on that would
   * reshuffle the rows under the cursor as the window is dragged.
   */
  rows.sort((a, b) =>
    a.startMs - b.startMs
    || a.row.item.subject.localeCompare(b.row.item.subject)
    || a.row.item.id.localeCompare(b.row.item.id));
  return rows.map(entry => entry.row);
}

/** How many of these tasks the chart would actually draw. */
export function countTimelineRows(
  items: TodoItemWithId[],
  window: TimelineWindow,
): number {
  let count = 0;
  for (const item of items) {
    if (barGeometry(toMs(item.etsDateTime), toMs(item.etaDateTime), window)) count += 1;
  }
  return count;
}
