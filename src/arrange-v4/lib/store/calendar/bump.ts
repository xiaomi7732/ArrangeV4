/**
 * Date-bump logic for the Calendar backend.
 *
 * Any non-terminal item (`new`, `inProgress`, `blocked`) whose ETS is before
 * the start of today (UTC) is bumped forward to today. This compensates for
 * the ±30-day calendarView window used by the Matrix/Scrum fetches: without
 * bumping, items that fall behind would drift out of view. The bump applies
 * the moment an item becomes stale (i.e. its ETS rolls into yesterday) — not
 * only after it falls outside the window. The original planned dates are
 * preserved on the item so the user can see when it was first scheduled.
 *
 * This is calendar-backend-specific because it compensates for the
 * calendarView window; other backends that return all items don't need it.
 */

export function computeBumpedDates(
  etsDateTime: string | undefined,
  etaDateTime: string | undefined,
  now: Date = new Date()
): { etsDateTime: string; etaDateTime: string } | null {
  if (!etsDateTime || !etaDateTime) return null;

  const ets = new Date(etsDateTime);
  const eta = new Date(etaDateTime);

  if (isNaN(ets.getTime()) || isNaN(eta.getTime())) return null;

  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);

  if (ets >= todayStart) return null;

  const duration = eta.getTime() - ets.getTime();
  if (duration <= 0) return null;

  const bumpedEts = new Date(todayStart);
  bumpedEts.setUTCHours(ets.getUTCHours(), ets.getUTCMinutes(), ets.getUTCSeconds(), ets.getUTCMilliseconds());

  const bumpedEta = new Date(bumpedEts.getTime() + duration);

  return {
    etsDateTime: bumpedEts.toISOString(),
    etaDateTime: bumpedEta.toISOString(),
  };
}
