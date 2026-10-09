/**
 * Resolves a calendar item's real dates and the event anchor that carries it.
 *
 * Two different things used to share the event's start/end: the task's ETS/ETA
 * as the user planned them, and the position the event needs so it keeps
 * coming back from the ±30-day `calendarView` window. Whenever Arrange rolled
 * a stale item forward, the user's planned dates were overwritten — visible as
 * a "moved" badge and a remembered original. Now the real dates live in the
 * Arrange payload and the event start/end is only the anchor, so sweeping is
 * invisible and never rewrites what the user planned.
 *
 * Note: this module is compiled by tsconfig.test.json, which does not rewrite
 * the "@/" path alias, so imports here must stay relative.
 */
import { computeWindowAnchor, isSameInstant, isNearlySameInstant, INSTANT_TOLERANCE_MS } from './windowAnchor';
import { isNonTerminalStatus } from '../types';
import type { TodoStatus } from '../types';

export interface StoredDatesInput {
  /** Real ETS/ETA from the Arrange payload, when it has them. */
  storedEts?: string | null;
  storedEta?: string | null;
  /**
   * The anchor Arrange itself last wrote onto the event. When the event no
   * longer sits there, somebody moved it outside Arrange — in Outlook, say —
   * and that reschedule is the user's intent, so it wins over the payload.
   */
  storedAnchorStart?: string | null;
  storedAnchorEnd?: string | null;
  /**
   * Pre-bump dates recorded by the old bumping behaviour. For an item written
   * before the payload carried its own dates these *are* the real dates, so
   * reading them back migrates the item without a repair pass.
   */
  legacyOriginalEts?: string | null;
  legacyOriginalEta?: string | null;
  /** The event's current anchor. */
  eventStart?: string | null;
  eventEnd?: string | null;
}

export interface ResolveItemDatesInput extends StoredDatesInput {
  /** Caller-supplied dates; `undefined` means "left alone". */
  updatedEts?: string | null;
  updatedEta?: string | null;
  /** The status the item will have after this update. */
  status?: TodoStatus;
  now?: Date;
}

export interface ResolvedItemDates {
  /** The task's real dates, to be written into the Arrange payload. */
  etsDateTime: string | null;
  etaDateTime: string | null;
  /** Event start/end to patch. Undefined means the anchor needs no write. */
  anchorStart?: string;
  anchorEnd?: string;
  /** Where the event will sit once written — record it to detect outside edits. */
  storedAnchorStart: string | null;
  storedAnchorEnd: string | null;
}

/** True when the event no longer sits on the anchor Arrange last wrote. */
export function wasMovedOutsideArrange(input: StoredDatesInput): boolean {
  if (!input.storedAnchorStart && !input.storedAnchorEnd) return false;
  return !isNearlySameInstant(input.storedAnchorStart, input.eventStart)
    || !isNearlySameInstant(input.storedAnchorEnd, input.eventEnd);
}

/** An ETS/ETA pair is usable only if it is complete and runs forwards. */
function isUsablePair(ets: string | null, eta: string | null): boolean {
  if (!ets || !eta) return false;
  const start = new Date(ets).getTime();
  const end = new Date(eta).getTime();
  if (isNaN(start) || isNaN(end)) return false;
  return end > start;
}

/**
 * Whether an event looks like the old scheme's bump of the given dates: rolled
 * forward keeping the UTC time of day and the duration.
 *
 * A legacy item has no recorded anchor, so this is the only way to tell "this
 * event is where bumping put it" from "somebody rescheduled this in Outlook".
 */
function looksLikeBumpOf(
  ets: string | null,
  eta: string | null,
  eventStart: string | null | undefined,
  eventEnd: string | null | undefined,
): boolean {
  if (!ets || !eta || !eventStart || !eventEnd) return false;
  const start = new Date(ets);
  const end = new Date(eta);
  const anchorStart = new Date(eventStart);
  const anchorEnd = new Date(eventEnd);
  if ([start, end, anchorStart, anchorEnd].some(date => isNaN(date.getTime()))) return false;

  if (anchorStart.getTime() < start.getTime()) return false;
  if (Math.abs((anchorEnd.getTime() - anchorStart.getTime()) - (end.getTime() - start.getTime())) > INSTANT_TOLERANCE_MS) {
    return false;
  }
  const timeOfDay = (date: Date) => date.getTime() - Date.UTC(
    date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(),
  );
  return Math.abs(timeOfDay(anchorStart) - timeOfDay(start)) <= INSTANT_TOLERANCE_MS;
}

/**
 * The real ETS/ETA of an item as read back from storage.
 *
 * A legacy item's pre-bump originals come first: an older client may still be
 * bumping, and those originals are what the user planned. They are trusted only
 * while the event looks like where bumping would have put them — otherwise the
 * event has been rescheduled outside Arrange and that is the newer intent.
 *
 * Failing that, an event moved off the anchor Arrange recorded wins outright,
 * then the payload's own dates, and only then the event itself.
 */
export function resolveStoredDates(
  input: StoredDatesInput,
): { etsDateTime: string | null; etaDateTime: string | null } {
  const eventDates = {
    etsDateTime: input.eventStart ?? null,
    etaDateTime: input.eventEnd ?? null,
  };

  if (input.legacyOriginalEts || input.legacyOriginalEta) {
    // The old scheme cleared the two originals independently, so a legacy item
    // can hold one real date and one bumped one. Mixing them yields a backwards
    // range that would never anchor again, so such a pair is discarded whole.
    const restored = {
      etsDateTime: input.legacyOriginalEts ?? input.storedEts ?? eventDates.etsDateTime,
      etaDateTime: input.legacyOriginalEta ?? input.storedEta ?? eventDates.etaDateTime,
    };
    const usable = isUsablePair(restored.etsDateTime, restored.etaDateTime)
      && looksLikeBumpOf(restored.etsDateTime, restored.etaDateTime, input.eventStart, input.eventEnd);
    return usable ? restored : eventDates;
  }

  if (wasMovedOutsideArrange(input)) return eventDates;

  return {
    etsDateTime: input.storedEts ?? eventDates.etsDateTime,
    etaDateTime: input.storedEta ?? eventDates.etaDateTime,
  };
}

/**
 * The planned dates of an item arriving from elsewhere — a move or a copy.
 *
 * A legacy item carries the pre-bump originals the old scheme saved, and those,
 * not the rolled-forward ETS/ETA sitting beside them, are what the user planned.
 */
export function resolveIncomingDates(item: {
  etsDateTime?: string | null;
  etaDateTime?: string | null;
  originalEtsDateTime?: string | null;
  originalEtaDateTime?: string | null;
}): { etsDateTime: string | null; etaDateTime: string | null } {
  const own = { etsDateTime: item.etsDateTime ?? null, etaDateTime: item.etaDateTime ?? null };
  if (!item.originalEtsDateTime && !item.originalEtaDateTime) return own;

  const restored = {
    etsDateTime: item.originalEtsDateTime ?? own.etsDateTime,
    etaDateTime: item.originalEtaDateTime ?? own.etaDateTime,
  };
  return isUsablePair(restored.etsDateTime, restored.etaDateTime) ? restored : own;
}

export function resolveItemDates(input: ResolveItemDatesInput): ResolvedItemDates {
  const current = resolveStoredDates(input);

  const etsDateTime = input.updatedEts !== undefined ? input.updatedEts ?? null : current.etsDateTime;
  const etaDateTime = input.updatedEta !== undefined ? input.updatedEta ?? null : current.etaDateTime;

  const callerSetDates = input.updatedEts !== undefined || input.updatedEta !== undefined;

  let target: { start: string | null; end: string | null } | null;
  if (isNonTerminalStatus(input.status)) {
    const anchor = computeWindowAnchor(etsDateTime, etaDateTime, input.now);
    // Unusable dates (missing, invalid, or a non-positive duration) have no
    // anchor to compute; the event keeps whatever it already had rather than
    // being written to something arbitrary.
    target = anchor ?? (callerSetDates ? { start: etsDateTime, end: etaDateTime } : null);
  } else {
    // Terminal items are never anchored, and are never moved back to their
    // planned dates either: a task finished today but planned months ago would
    // drop straight out of the ±30-day window and vanish from the Finished
    // lane. The event simply stays where it is; the payload holds the dates.
    target = null;
  }

  const result: ResolvedItemDates = {
    etsDateTime,
    etaDateTime,
    storedAnchorStart: target?.start ?? input.eventStart ?? null,
    storedAnchorEnd: target?.end ?? input.eventEnd ?? null,
  };
  if (target?.start && !isSameInstant(target.start, input.eventStart)) {
    result.anchorStart = target.start;
  }
  if (target?.end && !isSameInstant(target.end, input.eventEnd)) {
    result.anchorEnd = target.end;
  }
  return result;
}
