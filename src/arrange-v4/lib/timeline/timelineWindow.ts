/**
 * Geometry and navigation for the timeline (Gantt) view.
 *
 * All of it is pure: a window is just two instants, and everything the chart
 * draws is derived from that pair. Keeping the arithmetic out of the component
 * is what makes zooming, panning and tick placement testable, which matters
 * because off-by-one errors in a chart are invisible until someone notices a
 * bar in the wrong week.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Below this the chart shows less than a quarter day and stops being a plan. */
export const MIN_SPAN_MS = 6 * HOUR;
/** Above this the bars are thinner than a pixel and the labels collide. */
export const MAX_SPAN_MS = 400 * DAY;

export interface TimelineWindow {
  /** Inclusive left edge, epoch milliseconds. */
  startMs: number;
  /** Exclusive right edge, epoch milliseconds. */
  endMs: number;
}

export interface BarGeometry {
  /** Distance from the left edge of the chart, as a percentage. */
  leftPercent: number;
  /** Bar length, as a percentage of the chart width. */
  widthPercent: number;
  /** The bar starts before the window, so its left end is cut off. */
  clippedStart: boolean;
  /** The bar ends after the window, so its right end is cut off. */
  clippedEnd: boolean;
}

export interface TimeAxisTick {
  /** Position along the chart, as a percentage. */
  positionPercent: number;
  /** Instant the tick marks, epoch milliseconds. */
  timeMs: number;
  /** Short label, e.g. "9 AM", "Mar 3", "Mar 26". */
  label: string;
  /** A day boundary, or the first of a month on coarser scales. */
  major: boolean;
}

export type TimelineGranularity = 'hour' | 'day' | 'week' | 'month';

export function spanOf(window: TimelineWindow): number {
  return window.endMs - window.startMs;
}

export function clampSpan(spanMs: number): number {
  if (!Number.isFinite(spanMs) || spanMs <= 0) return MIN_SPAN_MS;
  return Math.min(MAX_SPAN_MS, Math.max(MIN_SPAN_MS, spanMs));
}

/** Builds a window of `spanMs` centred on `centerMs`. */
export function createWindow(centerMs: number, spanMs: number): TimelineWindow {
  const span = clampSpan(spanMs);
  const half = span / 2;
  return { startMs: centerMs - half, endMs: centerMs + half };
}

/**
 * The default view: today plus a week and a half ahead, which is the range a
 * person can actually act on, with a few days of context behind.
 */
export function defaultWindow(now: Date = new Date()): TimelineWindow {
  // Calendar arithmetic, not 24-hour multiples: a daylight-saving change in
  // the padding would otherwise leave the window starting at 11pm.
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 11);
  return { startMs: start.getTime(), endMs: end.getTime() };
}

/**
 * Zooms by `factor` (below 1 zooms in) while holding the instant at
 * `anchorRatio` still, so zooming toward the pointer keeps whatever is under
 * it in place. The span is clamped, and the anchor still holds at the clamp.
 */
export function zoomWindow(
  window: TimelineWindow,
  factor: number,
  anchorRatio = 0.5,
): TimelineWindow {
  const span = spanOf(window);
  const nextSpan = clampSpan(span * factor);
  const ratio = Math.min(1, Math.max(0, anchorRatio));
  const anchorMs = window.startMs + span * ratio;
  const startMs = anchorMs - nextSpan * ratio;
  return { startMs, endMs: startMs + nextSpan };
}

/**
 * Slides the window by a fraction of its own width, so a pan feels the same
 * however far the user is zoomed in. Positive moves toward the future.
 */
export function panWindow(window: TimelineWindow, deltaRatio: number): TimelineWindow {
  const delta = spanOf(window) * deltaRatio;
  return { startMs: window.startMs + delta, endMs: window.endMs + delta };
}

/** Re-centres the window on an instant without changing the zoom level. */
export function centerWindowOn(window: TimelineWindow, timeMs: number): TimelineWindow {
  return createWindow(timeMs, spanOf(window));
}

/** Where an instant falls in the window, as a percentage. Not clamped. */
export function positionPercent(timeMs: number, window: TimelineWindow): number {
  const span = spanOf(window);
  if (span <= 0) return 0;
  return ((timeMs - window.startMs) / span) * 100;
}

/**
 * Places a task's bar, clipped to the window.
 *
 * Returns null when the task falls entirely outside the window, so the caller
 * can drop the row rather than render a zero-width stub. Reversed or missing
 * dates are treated as a single instant rather than discarded: a task with a
 * bad range should still be visible so it can be found and fixed.
 */
export function barGeometry(
  startMs: number | null,
  endMs: number | null,
  window: TimelineWindow,
): BarGeometry | null {
  const hasStart = startMs !== null && Number.isFinite(startMs);
  const hasEnd = endMs !== null && Number.isFinite(endMs);
  if (!hasStart && !hasEnd) return null;

  const rawStart = hasStart ? (startMs as number) : (endMs as number);
  const rawEnd = hasEnd ? (endMs as number) : (startMs as number);
  const from = Math.min(rawStart, rawEnd);
  const to = Math.max(rawStart, rawEnd);

  // The right edge is exclusive: a task that only starts where the window ends
  // belongs to the next period, and drawing it would put a zero-width bar hard
  // against the edge and count it as visible.
  if (to < window.startMs || from >= window.endMs) return null;

  const visibleFrom = Math.max(from, window.startMs);
  const visibleTo = Math.min(to, window.endMs);
  const left = positionPercent(visibleFrom, window);
  const right = positionPercent(visibleTo, window);

  return {
    leftPercent: left,
    widthPercent: Math.max(0, right - left),
    clippedStart: from < window.startMs,
    clippedEnd: to > window.endMs,
  };
}

/** Picks a tick spacing that yields a readable number of labels for the span. */
export function granularityFor(window: TimelineWindow): TimelineGranularity {
  const span = spanOf(window);
  if (span <= 3 * DAY) return 'hour';
  if (span <= 45 * DAY) return 'day';
  if (span <= 150 * DAY) return 'week';
  return 'month';
}

function startOfLocalDay(timeMs: number): Date {
  const d = new Date(timeMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function hourStep(spanMs: number): number {
  // Keep roughly a dozen labels whatever the zoom, on hours people recognise.
  for (const hours of [1, 2, 3, 6, 12]) {
    if (spanMs / (hours * HOUR) <= 14) return hours;
  }
  return 12;
}

function formatTick(date: Date, granularity: TimelineGranularity): string {
  switch (granularity) {
    case 'hour':
      return date.getHours() === 0
        ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        : date.toLocaleTimeString(undefined, { hour: 'numeric' });
    case 'day':
    case 'week':
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    case 'month':
      return date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
  }
}

// A tick per rendered pixel would be noise; this is a safety valve only.
const MAX_TICKS = 400;

/**
 * Lays out the axis labels for a window.
 *
 * Ticks land on local calendar boundaries rather than on even multiples of the
 * span, so "Mar 3" sits where March 3rd actually starts, including across a
 * daylight-saving change. The window end is exclusive, so a tick exactly at
 * `endMs` is left out: it would sit on the right edge and label a moment that
 * is not in view.
 */
export function buildTimeAxisTicks(window: TimelineWindow): TimeAxisTick[] {
  const span = spanOf(window);
  if (!(span > 0)) return [];

  const granularity = granularityFor(window);
  const ticks: TimeAxisTick[] = [];

  if (granularity === 'hour') {
    const step = hourStep(span);
    // Each tick is built from its own day's midnight rather than by adding to
    // the previous one: on a spring-forward day, adding two hours to a 1am
    // tick lands on 3am and every later tick that day sits on an odd hour.
    let day = startOfLocalDay(window.startMs);
    while (day.getTime() < window.endMs && ticks.length < MAX_TICKS) {
      for (let hour = 0; hour < 24; hour += step) {
        const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour);
        // The hour a spring-forward skips does not exist: asking for 2am on
        // that day yields 3am, which would duplicate the real 3am tick — and
        // duplicate the React key the chart draws it with.
        if (at.getHours() !== hour) continue;
        if (at.getTime() < window.startMs) continue;
        if (at.getTime() >= window.endMs || ticks.length >= MAX_TICKS) break;
        if (ticks.length > 0 && at.getTime() <= ticks[ticks.length - 1].timeMs) continue;
        ticks.push({
          positionPercent: positionPercent(at.getTime(), window),
          timeMs: at.getTime(),
          label: formatTick(at, 'hour'),
          major: at.getHours() === 0,
        });
      }
      day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    }
    return ticks;
  }

  if (granularity === 'month') {
    const start = new Date(window.startMs);
    let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    if (cursor.getTime() < window.startMs) {
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
    while (cursor.getTime() < window.endMs && ticks.length < MAX_TICKS) {
      ticks.push({
        positionPercent: positionPercent(cursor.getTime(), window),
        timeMs: cursor.getTime(),
        label: formatTick(cursor, 'month'),
        major: cursor.getMonth() === 0,
      });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
    return ticks;
  }

  const stepDays = granularity === 'week' ? 7 : 1;
  let cursor = startOfLocalDay(window.startMs);
  if (granularity === 'week') {
    // Weekly labels are anchored to Mondays rather than to whatever day the
    // window happens to start on, so panning a day at a time does not make
    // every label jump to a different date.
    const toMonday = (8 - cursor.getDay()) % 7;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + toMonday);
  }
  if (cursor.getTime() < window.startMs) {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + stepDays);
  }
  while (cursor.getTime() < window.endMs && ticks.length < MAX_TICKS) {
    ticks.push({
      positionPercent: positionPercent(cursor.getTime(), window),
      timeMs: cursor.getTime(),
      label: formatTick(cursor, granularity),
      // At weekly spacing a tick almost never lands on the 1st, so the first
      // week of a month stands in for the month boundary.
      major: granularity === 'week' ? cursor.getDate() <= stepDays : cursor.getDate() === 1,
    });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + stepDays);
  }
  return ticks;
}

/** Describes the visible range in words, for the chart header. */
export function describeWindow(window: TimelineWindow): string {
  const opts: Intl.DateTimeFormatOptions = spanOf(window) <= 3 * DAY
    ? { month: 'short', day: 'numeric', hour: 'numeric' }
    : { year: 'numeric', month: 'short', day: 'numeric' };
  const from = new Date(window.startMs).toLocaleString(undefined, opts);
  // The end is exclusive, so naming it would advertise a day that is not on
  // screen: a window ending at midnight on the 16th shows up to the 15th.
  const to = new Date(window.endMs - 1).toLocaleString(undefined, opts);
  return `${from} – ${to}`;
}

/**
 * The range of data to fetch for a window.
 *
 * Padded by half the span on each side so a pan or a zoom out has something to
 * show immediately instead of a blank chart, and snapped to whole days to keep
 * the request stable while the user nudges the window around.
 */
export function fetchRangeFor(window: TimelineWindow): { startMs: number; endMs: number } {
  const pad = spanOf(window) / 2;
  const from = startOfLocalDay(window.startMs - pad);
  const toDay = startOfLocalDay(window.endMs + pad);
  const to = new Date(toDay.getFullYear(), toDay.getMonth(), toDay.getDate() + 1);
  return { startMs: from.getTime(), endMs: to.getTime() };
}
