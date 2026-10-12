/**
 * Budgeting and bookkeeping for the scan that looks for items whose window
 * anchor has drifted out of reach of every window the views fetch.
 *
 * Two things make a naive scan a bad idea. The history it reads is mostly
 * finished tasks, which never need sweeping — so budgeting by events read
 * would spend the whole allowance on the same unchanging prefix every session
 * and starve an open task sitting behind it. And that history only grows, so
 * re-reading it from the top every session costs the user bandwidth forever.
 *
 * So the budget is spent on *candidates* (terminal and unreadable rows cost
 * nothing), and how far back a book has been read is remembered between
 * sessions: a later pass reads the days that have newly drifted plus a slice
 * further into the backlog, until the backlog runs out.
 *
 * The one invariant everything here protects: the remembered progress names a
 * single *contiguous* span that has really been read. Whenever a pass stops
 * short of covering the span it claimed, the claim is narrowed to what was
 * actually read rather than extended over the gap — re-reading some history is
 * cheap, but skipping a stretch of it would hide an item forever, which is the
 * very thing this scan exists to prevent.
 *
 * Note: this module is compiled by tsconfig.test.json, which does not rewrite
 * the "@/" path alias, so imports here must stay relative.
 */

import { isNonTerminalStatus } from '../types';
import type { TodoItemWithId } from '../types';
import { computeWindowAnchor, toGraphFilterDateTime } from './windowAnchor';

/** How many sweepable items one scan will collect per book. */
export const ANCHOR_HOLE_SCAN_MAX_CANDIDATES = 200;

/**
 * How many pages of history one scan will read per book. Small, because the
 * backlog is resumed rather than re-read: a book deep enough to hit this is
 * read a little further on each later pass.
 */
export const ANCHOR_HOLE_SCAN_MAX_PAGES = 5;

/**
 * How long a fully-scanned book is trusted before its backlog is read again.
 *
 * Reaching the end of the history is not forever: the user can drag an event
 * in Outlook back into a stretch already read, and nothing would ever look
 * there again. Starting over now and then costs one deep read a month and
 * makes the scan self-healing.
 */
export const ANCHOR_SCAN_RECHECK_DAYS = 30;

export interface AnchorHoleScanLimits {
  maxCandidates: number;
  maxPages: number;
}

export const DEFAULT_ANCHOR_HOLE_SCAN_LIMITS: AnchorHoleScanLimits = {
  maxCandidates: ANCHOR_HOLE_SCAN_MAX_CANDIDATES,
  maxPages: ANCHOR_HOLE_SCAN_MAX_PAGES,
};

/** How far a book has been read, so a later pass can carry on from there. */
export interface AnchorScanProgress {
  /** The oldest event end read so far; everything up to `to` has been seen. */
  from: string | null;
  /** The cutoff the last pass used. The span really read is `[from, to]`. */
  to: string | null;
  /** True once a pass reached the start of the book's history. */
  complete: boolean;
  /** When that happened, so the book is eventually read again. */
  completedAt: string | null;
}

/** One `end/dateTime` span to ask the calendar for: `[from, to]`. */
export interface AnchorHoleSlice {
  from: string | null;
  to: string;
}

/** One row of a page: the item it parsed to, the event's end, and whether the
 * event carried an Arrange payload at all. */
export interface AnchorHolePageEntry {
  item: TodoItemWithId | null;
  end: string | null | undefined;
  /**
   * Whether the event is one of ours. Taken from the body rather than from a
   * parsed field, because a partial payload is valid: a task saved with no
   * explicit status reads back as `new` everywhere else, and must here too.
   */
  hasArrangePayload: boolean;
}

export interface AnchorHoleScanState {
  candidates: TodoItemWithId[];
  pagesRead: number;
  /**
   * The oldest event end this pass actually processed. Rows left behind when
   * the candidate budget ran out do not count: resuming from below them would
   * skip the ones that were dropped.
   */
  oldestEndRead: string | null;
  /** True when the candidate budget stopped the pass mid-page. */
  capped: boolean;
}

export const initialAnchorHoleScanState: AnchorHoleScanState = {
  candidates: [],
  pagesRead: 0,
  oldestEndRead: null,
  capped: false,
};

/**
 * Whether a drifted item is worth collecting. Terminal items are deliberately
 * not anchored, and a write to an unreadable one is refused, so sweeping
 * either would be wasted effort — or, for the unreadable, a guaranteed failure
 * that would keep the session sweep from ever being marked done.
 *
 * An event carrying no Arrange data at all is skipped too. The scan reaches
 * the whole of a calendar's history, where such an event is far more likely to
 * be something the user put in the calendar themselves than a task of ours,
 * and sweeping would move it and write a task body into it. That is decided
 * by whether the body held a payload, not by whether a status came out of it:
 * a partial payload is still ours, and reads back as `new`.
 *
 * The test matches what the sweep itself will act on, down to the dates being
 * usable: an item the sweep would pass over must not spend the budget an item
 * it would repair is waiting for.
 */
export function isAnchorHoleCandidate(
  item: TodoItemWithId,
  hasArrangePayload: boolean,
): boolean {
  return (
    Boolean(item.id) &&
    !item.dataUnreadable &&
    hasArrangePayload &&
    isNonTerminalStatus(item.status) &&
    computeWindowAnchor(item.etsDateTime, item.etaDateTime) !== null
  );
}

/** The older of two instants, ignoring any that cannot be read. */
export function oldestInstant(
  a: string | null | undefined,
  b: string | null | undefined,
): string | null {
  const left = a ? new Date(a).getTime() : NaN;
  const right = b ? new Date(b).getTime() : NaN;
  if (isNaN(left)) return isNaN(right) ? null : b ?? null;
  if (isNaN(right)) return a ?? null;
  return left <= right ? a ?? null : b ?? null;
}

/**
 * Folds one page of results into the scan, stopping at the candidate budget.
 *
 * Rows are taken in the order the calendar returned them — newest end first —
 * and the pass only claims to have read as far back as the last row it looked
 * at. Stopping mid-page therefore leaves the rest of that page unread rather
 * than silently skipped.
 */
export function accumulateAnchorHolePage(
  state: AnchorHoleScanState,
  page: AnchorHolePageEntry[],
  limits: AnchorHoleScanLimits = DEFAULT_ANCHOR_HOLE_SCAN_LIMITS,
): AnchorHoleScanState {
  const seen = new Set(state.candidates.map(item => item.id));
  const candidates = [...state.candidates];
  let oldestEndRead = state.oldestEndRead;
  let capped = state.capped;

  for (const entry of page) {
    if (candidates.length >= limits.maxCandidates) {
      capped = true;
      break;
    }
    oldestEndRead = oldestInstant(oldestEndRead, entry.end);
    const item = entry.item;
    if (!item || !isAnchorHoleCandidate(item, entry.hasArrangePayload) || seen.has(item.id)) continue;
    seen.add(item.id);
    candidates.push(item);
  }

  return { candidates, pagesRead: state.pagesRead + 1, oldestEndRead, capped };
}

/** Whether another page should be read, given what the last one returned. */
export function shouldReadNextAnchorHolePage(
  state: AnchorHoleScanState,
  hasNextPage: boolean,
  limits: AnchorHoleScanLimits = DEFAULT_ANCHOR_HOLE_SCAN_LIMITS,
): boolean {
  return (
    hasNextPage &&
    !state.capped &&
    state.pagesRead < limits.maxPages &&
    state.candidates.length < limits.maxCandidates
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The progress a pass should start from, or null to start over.
 *
 * Progress is dropped when it has gone stale (a fully-read book is worth
 * checking again eventually) or when it cannot be true — a `to` in the future
 * means the clock was wrong when it was written, and trusting it would skip
 * everything up to that instant.
 */
export function refreshAnchorScanProgress(
  progress: AnchorScanProgress | null,
  now: Date = new Date(),
): AnchorScanProgress | null {
  if (!progress || !progress.to) return null;

  const to = new Date(progress.to).getTime();
  if (isNaN(to) || to > now.getTime()) return null;

  if (progress.complete) {
    const completedAt = progress.completedAt ? new Date(progress.completedAt).getTime() : NaN;
    if (isNaN(completedAt)) return { ...progress, completedAt: now.toISOString() };
    if (now.getTime() - completedAt > ANCHOR_SCAN_RECHECK_DAYS * DAY_MS) return null;
  }

  return progress;
}

/**
 * The spans this pass should ask for, newest first.
 *
 * With nothing remembered, that is the whole backlog below the cutoff. With a
 * previous pass remembered, it is the days that have drifted since — the ones
 * most likely to matter — followed by a slice further into the backlog, which
 * is skipped once the backlog has been read to its end.
 */
export function anchorHoleScanSlices(
  cutoff: string,
  progress: AnchorScanProgress | null,
): AnchorHoleSlice[] {
  if (!progress || !progress.to) return [{ from: null, to: cutoff }];

  const slices: AnchorHoleSlice[] = [];
  if (new Date(progress.to).getTime() < new Date(cutoff).getTime()) {
    slices.push({ from: progress.to, to: cutoff });
  }
  if (!progress.complete) {
    // One millisecond past the oldest event already read, so an event sharing
    // that exact instant is not skipped at the seam; duplicates are dropped
    // when the page is folded in.
    const resumeTo = progress.from
      ? new Date(new Date(progress.from).getTime() + 1).toISOString()
      : cutoff;
    slices.push({ from: null, to: resumeTo });
  }
  return slices;
}

/** The `$filter` for one span. */
export function anchorHoleFilter(slice: AnchorHoleSlice): string {
  // `le`, not `lt`: the window query is a calendarView starting at this same
  // instant and returns only events that extend past it, so an event ending
  // exactly on the boundary belongs to neither side under `lt`. Both bounds
  // round outwards for the same reason — a slightly wider query costs a few
  // rows, a slightly narrower one loses events for good.
  const upper = `end/dateTime le '${toGraphFilterDateTime(slice.to, 'up')}'`;
  if (!slice.from) return upper;
  return `${upper} and end/dateTime ge '${toGraphFilterDateTime(slice.from, 'down')}'`;
}

/** How a pass ended, which decides what it may claim to have read. */
export interface AnchorHoleScanOutcome {
  /**
   * True when the newly-drifted slice was cut short. Only the part of it the
   * pass reached is contiguous with the cutoff, so everything below that
   * becomes backlog again rather than staying covered.
   */
  freshTruncated: boolean;
  /** True when a backlog slice ran to the start of the calendar's history. */
  backlogExhausted: boolean;
}

/**
 * Where the book stands after this pass.
 *
 * `backlogExhausted` means the backlog slice ran to the end of the calendar's
 * history; a book is only ever marked complete on that evidence.
 */
export function nextAnchorScanProgress(
  previous: AnchorScanProgress | null,
  cutoff: string,
  state: AnchorHoleScanState,
  outcome: AnchorHoleScanOutcome,
  now: Date = new Date(),
): AnchorScanProgress {
  if (outcome.freshTruncated) {
    // Nothing was read at all, so there is nothing new to claim.
    if (!state.oldestEndRead) {
      return previous ?? { from: null, to: cutoff, complete: false, completedAt: null };
    }
    return {
      from: state.oldestEndRead,
      to: cutoff,
      complete: false,
      completedAt: null,
    };
  }

  const complete = Boolean(previous?.complete) || outcome.backlogExhausted;
  return {
    from: oldestInstant(previous?.from ?? null, state.oldestEndRead),
    to: cutoff,
    complete,
    completedAt: complete ? previous?.completedAt ?? now.toISOString() : null,
  };
}

/**
 * Whether the backlog has stopped moving because of a wall of events sharing
 * one `end` instant.
 *
 * The backlog resumes at the oldest instant already read, inclusively, so an
 * instant held by more events than one pass can read would otherwise be the
 * end of the line: every later pass reads the same prefix of them and never
 * reaches what lies below.
 */
export function isStalledOnTie(
  resumeFrom: AnchorScanProgress | null,
  slice: AnchorHoleSlice,
  state: AnchorHoleScanState,
): boolean {
  if (slice.from !== null || !resumeFrom?.from || !state.oldestEndRead) return false;
  // Nothing is stuck while the budget is still filling with work to do.
  if (state.capped) return false;
  return new Date(state.oldestEndRead).getTime() >= new Date(resumeFrom.from).getTime();
}

/**
 * The budget for reading through such a wall: no page limit at all.
 *
 * It is bounded in practice by how many events share one exact instant, and
 * the cost is paid once — the next pass resumes below the whole run. Any
 * finite cap would simply move the stall rather than remove it: a run longer
 * than the cap would be re-read from the top every pass, and the history
 * below it would never be reached.
 */
export function tieDrainLimits(limits: AnchorHoleScanLimits): AnchorHoleScanLimits {
  return { ...limits, maxPages: Number.POSITIVE_INFINITY };
}

/** Rejects anything read back from storage that is not usable progress. */
export function sanitizeAnchorScanProgress(raw: unknown): AnchorScanProgress | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<AnchorScanProgress>;
  const isInstant = (v: unknown): v is string =>
    typeof v === 'string' && !isNaN(new Date(v).getTime());
  if (!isInstant(value.to)) return null;
  const complete = value.complete === true;
  return {
    from: isInstant(value.from) ? value.from : null,
    to: value.to,
    complete,
    completedAt: complete && isInstant(value.completedAt) ? value.completedAt : null,
  };
}

export interface AnchorHoleScanResult {
  items: TodoItemWithId[];
  /** True when this pass stopped short and left history for a later one. */
  truncated: boolean;
  progress: AnchorScanProgress;
}
