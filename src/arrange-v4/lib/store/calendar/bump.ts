/**
 * Date-bump logic for the Calendar backend.
 *
 * Non-terminal items (`new`, `inProgress`, `blocked`) that have fallen outside
 * the ±30-day calendarView window are bumped forward to today on update.
 * The original planned dates are preserved on the item so the user can see
 * when it was first scheduled.
 *
 * This is calendar-backend-specific because it compensates for the calendarView
 * window; other backends that return all items don't need it.
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
