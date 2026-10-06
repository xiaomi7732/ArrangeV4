/**
 * The arithmetic behind dragging a bar's edge on the timeline.
 *
 * Kept away from the chart so the rules a user will feel — what a pixel is
 * worth, where a dragged edge snaps, and what happens when they drag one end
 * past the other — can be stated once and tested.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Which end of a bar is being dragged. */
export type BarEdge = 'start' | 'end';

/**
 * How far apart the positions a dragged edge can take are.
 *
 * The step follows the zoom: at a day's view a minute is a fraction of a pixel,
 * so snapping to five minutes keeps the result both reachable and tidy, while
 * a year's view snaps to whole days because nothing finer is visible anyway.
 */
export function snapStepFor(spanMs: number): number {
  if (spanMs <= 2 * DAY) return 5 * MINUTE;
  if (spanMs <= 10 * DAY) return 15 * MINUTE;
  if (spanMs <= 45 * DAY) return HOUR;
  return DAY;
}

/** Rounds an instant to the nearest step, measured from the local midnight before it. */
export function snapToStep(timeMs: number, stepMs: number): number {
  if (!(stepMs > 0)) return timeMs;
  const at = new Date(timeMs);
  /*
   * A whole-day step lands on a local midnight rather than on a multiple of
   * 24 hours: the two part company on the days the clocks change, and a task
   * snapped to 23:00 or 01:00 on exactly those days would look like a bug.
   */
  if (stepMs % DAY === 0) {
    const days = stepMs / DAY;
    const before = new Date(at.getFullYear(), at.getMonth(), at.getDate());
    const after = new Date(at.getFullYear(), at.getMonth(), at.getDate() + days);
    return timeMs - before.getTime() < after.getTime() - timeMs
      ? before.getTime()
      : after.getTime();
  }
  const dayStart = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
  // Anchoring on the local day keeps a snapped edge on the hour (or the day)
  // the user sees on the axis, which an anchor on the epoch would miss in any
  // zone offset by half an hour.
  const offset = timeMs - dayStart;
  return dayStart + Math.round(offset / stepMs) * stepMs;
}

export interface ResizeInput {
  /** The task's current ETS, or null when it has none. */
  startMs: number | null;
  /** The task's current ETA, or null when it has none. */
  endMs: number | null;
  edge: BarEdge;
  /** How far the pointer has travelled, in milliseconds of chart time. */
  deltaMs: number;
  stepMs: number;
}

export interface ResizeResult {
  startMs: number;
  endMs: number;
}

/**
 * Moves one edge of a bar by a drag.
 *
 * Dragging an edge past the other one collapses the task to an instant rather
 * than inverting it: a task that ends before it starts is not something the
 * rest of the app can draw, and silently swapping the two would move an end
 * the user never touched.
 *
 * A task dated at only one end is treated as an instant, which is how it is
 * drawn, so dragging either side of that marker still produces a real range.
 */
export function resizeBar({ startMs, endMs, edge, deltaMs, stepMs }: ResizeInput): ResizeResult {
  const from = startMs ?? endMs;
  const to = endMs ?? startMs;
  if (from === null || to === null) {
    throw new Error('resizeBar needs a task with at least one date');
  }
  const low = Math.min(from, to);
  const high = Math.max(from, to);

  if (edge === 'start') {
    const moved = snapToStep(low + deltaMs, stepMs);
    return { startMs: Math.min(moved, high), endMs: high };
  }
  const moved = snapToStep(high + deltaMs, stepMs);
  return { startMs: low, endMs: Math.max(moved, low) };
}

/** Turns a horizontal travel in pixels into the time it covers. */
export function msPerPixel(spanMs: number, widthPx: number): number {
  if (!(widthPx > 0)) return 0;
  return spanMs / widthPx;
}

/**
 * The keyboard equivalent of a drag: one step, or a bigger jump with Shift.
 *
 * Without it the handles would be mouse-only, and the chart would be the one
 * place in the app where a date cannot be changed from the keyboard.
 */
export function nudgeStep(stepMs: number, coarse: boolean): number {
  if (!coarse) return stepMs;
  return stepMs >= DAY ? 7 * stepMs : Math.max(stepMs, HOUR) * 4;
}
