/**
 * Window-anchor logic for the Calendar backend.
 *
 * Matrix/Scrum fetch items through a ±30-day `calendarView` window, so an
 * event whose start drifts far enough into the past stops coming back and the
 * task silently disappears from the board. To prevent that, Arrange keeps the
 * *event's* start/end — its window anchor — rolled forward to today for any
 * non-terminal item whose anchor has gone stale.
 *
 * The anchor is storage plumbing, not user data: the task's real ETS/ETA live
 * in the Arrange payload and are never moved by anchoring. Other backends
 * return every item regardless of date and therefore have no anchor at all.
 *
 * Note: this module is compiled by tsconfig.test.json, which does not rewrite
 * the "@/" path alias, so imports here must stay relative.
 */

export interface WindowAnchor {
  start: string;
  end: string;
}

function startOfTodayUtc(now: Date): Date {
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);
  return todayStart;
}

/**
 * Where the event should sit so the item stays inside the calendarView window,
 * given the task's real dates. Returns null when the dates are unusable.
 *
 * Dates that are already current anchor themselves: the event sits on the real
 * ETS/ETA, which is both correct in Outlook and inside the window. Only stale
 * dates are rolled forward, preserving the time of day and the ETS→ETA
 * duration so a glance at the calendar still shows a task of the right length.
 */
export function computeWindowAnchor(
  etsDateTime: string | null | undefined,
  etaDateTime: string | null | undefined,
  now: Date = new Date(),
): WindowAnchor | null {
  if (!etsDateTime || !etaDateTime) return null;

  const ets = new Date(etsDateTime);
  const eta = new Date(etaDateTime);
  if (isNaN(ets.getTime()) || isNaN(eta.getTime())) return null;

  const duration = eta.getTime() - ets.getTime();
  if (duration <= 0) return null;

  const todayStart = startOfTodayUtc(now);
  if (ets >= todayStart) {
    return { start: ets.toISOString(), end: eta.toISOString() };
  }

  const anchorStart = new Date(todayStart);
  anchorStart.setUTCHours(
    ets.getUTCHours(),
    ets.getUTCMinutes(),
    ets.getUTCSeconds(),
    ets.getUTCMilliseconds(),
  );
  const anchorEnd = new Date(anchorStart.getTime() + duration);

  return { start: anchorStart.toISOString(), end: anchorEnd.toISOString() };
}

/**
 * Whether an event's current anchor has fallen behind today and should be
 * rolled forward. Sweeping asks this, not whether the task's own ETS is old:
 * a task may legitimately keep a long-past ETS forever, and that is no reason
 * to touch its event.
 */
export function isWindowAnchorStale(
  anchorStart: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!anchorStart) return false;
  const start = new Date(anchorStart);
  if (isNaN(start.getTime())) return false;
  return start < startOfTodayUtc(now);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How far back an anchor may sit and still be considered "near today". It
 * matches the boards' own ±30-day window: an anchor older than that is already
 * beyond everything Arrange fetches.
 */
export const ANCHOR_ZONE_LOOKBACK_DAYS = 30;

/**
 * The date ranges that together cover a window query and the zone anchors live
 * in.
 *
 * A query like the Timeline's asks Graph for events in a period, but Graph
 * matches on the event — the anchor — while the caller cares about the task's
 * planned dates. An open task planned long ago is anchored near today, so a
 * query for its planned period would miss it. Fetching the anchor zone as well
 * brings it back; the caller filters on the real dates, as it already must.
 *
 * Overlapping ranges are merged into one query. Disjoint ones stay separate:
 * a Timeline window a year out would otherwise drag back every event in
 * between.
 */
export function anchorZoneRanges(
  fromDate: string,
  toDate: string,
  now: Date = new Date(),
): { fromDate: string; toDate: string }[] {
  const todayStart = startOfTodayUtc(now);
  const zoneFrom = todayStart.getTime() - ANCHOR_ZONE_LOOKBACK_DAYS * DAY_MS;
  const zoneTo = todayStart.getTime() + DAY_MS;

  const from = new Date(fromDate).getTime();
  const to = new Date(toDate).getTime();
  if (isNaN(from) || isNaN(to)) return [{ fromDate, toDate }];

  if (from <= zoneTo && to >= zoneFrom) {
    return [{
      fromDate: new Date(Math.min(from, zoneFrom)).toISOString(),
      toDate: new Date(Math.max(to, zoneTo)).toISOString(),
    }];
  }

  const zone = { fromDate: new Date(zoneFrom).toISOString(), toDate: new Date(zoneTo).toISOString() };
  return from > zoneTo ? [zone, { fromDate, toDate }] : [{ fromDate, toDate }, zone];
}

/**
 * How close two instants must be to count as the same one. Graph stores event
 * times at its own precision, so an anchor read back can differ from the one
 * written by well under a second — which must not be mistaken for the user
 * rescheduling the event in Outlook.
 */
export const INSTANT_TOLERANCE_MS = 60_000;

/** True when two instants are the same, tolerating different ISO spellings. */
export function isSameInstant(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return a === b || (!a && !b);
  const left = new Date(a).getTime();
  const right = new Date(b).getTime();
  if (isNaN(left) || isNaN(right)) return false;
  return left === right;
}

/** As `isSameInstant`, but allowing for the storage backend's own rounding. */
export function isNearlySameInstant(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return a === b || (!a && !b);
  const left = new Date(a).getTime();
  const right = new Date(b).getTime();
  if (isNaN(left) || isNaN(right)) return false;
  return Math.abs(left - right) <= INSTANT_TOLERANCE_MS;
}
