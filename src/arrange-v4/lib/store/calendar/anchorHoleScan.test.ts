import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  accumulateAnchorHolePage,
  anchorHoleFilter,
  anchorHoleScanSlices,
  initialAnchorHoleScanState,
  isAnchorHoleCandidate,
  nextAnchorScanProgress,
  oldestInstant,
  refreshAnchorScanProgress,
  sanitizeAnchorScanProgress,
  shouldReadNextAnchorHolePage,
  ANCHOR_SCAN_RECHECK_DAYS,
  type AnchorHolePageEntry,
  type AnchorHoleScanLimits,
  type AnchorScanProgress,
} from './anchorHoleScan';
import type { TodoItemWithId, TodoStatus } from '../types';

const LIMITS: AnchorHoleScanLimits = { maxCandidates: 3, maxPages: 2 };
const CUTOFF = '2026-09-08T00:00:00.000Z';
const NOW = new Date('2026-10-08T12:00:00.000Z');

function item(
  id: string,
  status: TodoStatus = 'new',
  extra: Partial<TodoItemWithId> = {},
): TodoItemWithId {
  return {
    id,
    subject: id,
    status,
    etsDateTime: '2025-01-01T09:00:00.000Z',
    etaDateTime: '2025-01-01T10:00:00.000Z',
    ...extra,
  } as TodoItemWithId;
}

function rows(...items: TodoItemWithId[]): AnchorHolePageEntry[] {
  return items.map(value => ({ item: value, end: null }));
}

function ends(...values: (string | null)[]): AnchorHolePageEntry[] {
  return values.map(end => ({ item: null, end }));
}

describe('isAnchorHoleCandidate', () => {
  it('collects a drifted open item', () => {
    assert.equal(isAnchorHoleCandidate(item('a', 'inProgress')), true);
  });

  it('skips terminal items, which are never anchored', () => {
    assert.equal(isAnchorHoleCandidate(item('a', 'finished')), false);
    assert.equal(isAnchorHoleCandidate(item('a', 'cancelled')), false);
  });

  it('skips an unreadable item, whose write would be refused anyway', () => {
    assert.equal(isAnchorHoleCandidate(item('a', 'new', { dataUnreadable: true })), false);
  });

  it('skips an event carrying no Arrange data at all', () => {
    // Deep in a calendar's history these are far more likely to be the user's
    // own appointments than tasks of ours, and sweeping would rewrite them.
    const noPayload = { id: 'a', subject: 'a' } as TodoItemWithId;
    assert.equal(isAnchorHoleCandidate(noPayload), false);
  });

  it('skips an item the sweep could not re-anchor anyway', () => {
    // Without usable dates the sweep passes it over, so letting it take a
    // place in the budget would starve an item that can actually be repaired.
    assert.equal(isAnchorHoleCandidate(item('a', 'new', { etaDateTime: undefined })), false);
    assert.equal(
      isAnchorHoleCandidate(item('a', 'new', { etaDateTime: '2025-01-01T09:00:00.000Z' })),
      false,
    );
  });
});

describe('accumulateAnchorHolePage', () => {
  it('keeps only sweepable items', () => {
    const state = accumulateAnchorHolePage(
      initialAnchorHoleScanState,
      rows(item('done', 'finished'), item('open', 'blocked')),
      LIMITS,
    );
    assert.deepEqual(state.candidates.map(i => i.id), ['open']);
    assert.equal(state.pagesRead, 1);
  });

  it('does not collect the same item twice across pages', () => {
    const first = accumulateAnchorHolePage(initialAnchorHoleScanState, rows(item('a')), LIMITS);
    const second = accumulateAnchorHolePage(first, rows(item('a'), item('b')), LIMITS);
    assert.deepEqual(second.candidates.map(i => i.id), ['a', 'b']);
  });

  it('stops at the candidate budget', () => {
    const state = accumulateAnchorHolePage(
      initialAnchorHoleScanState,
      rows(item('a'), item('b'), item('c'), item('d')),
      LIMITS,
    );
    assert.deepEqual(state.candidates.map(i => i.id), ['a', 'b', 'c']);
    assert.equal(state.capped, true);
  });

  it('does not claim to have read past the row the budget stopped it on', () => {
    // Resuming from the bottom of the page would put 'd' below the resume
    // point and lose it for good, which is exactly the hole being closed.
    const page: AnchorHolePageEntry[] = [
      { item: item('a'), end: '2026-03-04T00:00:00.000Z' },
      { item: item('b'), end: '2026-03-03T00:00:00.000Z' },
      { item: item('c'), end: '2026-03-02T00:00:00.000Z' },
      { item: item('d'), end: '2026-03-01T00:00:00.000Z' },
    ];
    const state = accumulateAnchorHolePage(initialAnchorHoleScanState, page, LIMITS);
    assert.equal(state.oldestEndRead, '2026-03-02T00:00:00.000Z');
    assert.equal(state.capped, true);
  });

  it('remembers how far back the page reached', () => {
    const state = accumulateAnchorHolePage(
      initialAnchorHoleScanState,
      ends('2026-05-01T00:00:00.000Z', '2026-01-09T00:00:00.000Z', 'nonsense'),
      LIMITS,
    );
    assert.equal(state.oldestEndRead, '2026-01-09T00:00:00.000Z');
    assert.equal(state.capped, false);
  });
});

describe('shouldReadNextAnchorHolePage', () => {
  it('stops when the calendar has no more history', () => {
    const state = accumulateAnchorHolePage(initialAnchorHoleScanState, rows(item('a')), LIMITS);
    assert.equal(shouldReadNextAnchorHolePage(state, false, LIMITS), false);
  });

  it('keeps reading past pages of terminal items', () => {
    // The whole point: a page of finished tasks costs no budget, so an open
    // item behind them is still reached instead of being starved forever.
    const state = accumulateAnchorHolePage(
      initialAnchorHoleScanState,
      rows(item('x', 'finished'), item('y', 'cancelled')),
      LIMITS,
    );
    assert.equal(state.candidates.length, 0);
    assert.equal(shouldReadNextAnchorHolePage(state, true, LIMITS), true);
  });

  it('stops once the candidate budget is spent', () => {
    const state = accumulateAnchorHolePage(
      initialAnchorHoleScanState,
      rows(item('a'), item('b'), item('c')),
      LIMITS,
    );
    assert.equal(shouldReadNextAnchorHolePage(state, true, LIMITS), false);
  });

  it('stops once the page budget is spent', () => {
    let state = accumulateAnchorHolePage(initialAnchorHoleScanState, [], LIMITS);
    state = accumulateAnchorHolePage(state, [], LIMITS);
    assert.equal(state.pagesRead, LIMITS.maxPages);
    assert.equal(shouldReadNextAnchorHolePage(state, true, LIMITS), false);
  });
});

describe('anchorHoleScanSlices', () => {
  it('reads the whole backlog when nothing is remembered', () => {
    assert.deepEqual(anchorHoleScanSlices(CUTOFF, null), [{ from: null, to: CUTOFF }]);
  });

  it('reads what has newly drifted, then carries on into the backlog', () => {
    const progress: AnchorScanProgress = {
      from: '2025-01-01T00:00:00.000Z',
      to: '2026-09-01T00:00:00.000Z',
      complete: false,
      completedAt: null,
    };
    assert.deepEqual(anchorHoleScanSlices(CUTOFF, progress), [
      { from: '2026-09-01T00:00:00.000Z', to: CUTOFF },
      { from: null, to: '2025-01-01T00:00:00.001Z' },
    ]);
  });

  it('stops re-reading a backlog already read to its end', () => {
    const progress: AnchorScanProgress = {
      from: '2025-01-01T00:00:00.000Z',
      to: '2026-09-01T00:00:00.000Z',
      complete: true,
      completedAt: '2026-09-01T00:00:00.000Z',
    };
    assert.deepEqual(anchorHoleScanSlices(CUTOFF, progress), [
      { from: '2026-09-01T00:00:00.000Z', to: CUTOFF },
    ]);
  });

  it('asks for nothing when a complete book has not drifted further', () => {
    const progress: AnchorScanProgress = {
      from: null,
      to: CUTOFF,
      complete: true,
      completedAt: CUTOFF,
    };
    assert.deepEqual(anchorHoleScanSlices(CUTOFF, progress), []);
  });

  it('covers again what a cut-short pass never reached', () => {
    // The pass below ran out of budget partway down the newly-drifted slice,
    // so it only claimed [X, cutoff]; the next pass must come back for the
    // rest instead of resuming below it.
    const previous: AnchorScanProgress = {
      from: '2024-01-01T00:00:00.000Z',
      to: '2026-08-01T00:00:00.000Z',
      complete: true,
      completedAt: '2026-08-01T00:00:00.000Z',
    };
    const state = accumulateAnchorHolePage(
      initialAnchorHoleScanState,
      ends('2026-09-05T00:00:00.000Z'),
      LIMITS,
    );
    const progress = nextAnchorScanProgress(previous, CUTOFF, state, {
      freshTruncated: true,
      backlogExhausted: false,
    });
    assert.deepEqual(progress, {
      from: '2026-09-05T00:00:00.000Z',
      to: CUTOFF,
      complete: false,
      completedAt: null,
    });
    const next = anchorHoleScanSlices('2026-09-09T00:00:00.000Z', progress);
    assert.deepEqual(next, [
      { from: CUTOFF, to: '2026-09-09T00:00:00.000Z' },
      { from: null, to: '2026-09-05T00:00:00.001Z' },
    ]);
  });
});

describe('anchorHoleFilter', () => {
  it('bounds an open-ended slice at the cutoff', () => {
    assert.equal(
      anchorHoleFilter({ from: null, to: CUTOFF }),
      "end/dateTime le '2026-09-08T00:00:00'",
    );
  });

  it('bounds a resumed slice at both ends', () => {
    assert.equal(
      anchorHoleFilter({ from: '2026-09-01T00:00:00.000Z', to: CUTOFF }),
      "end/dateTime le '2026-09-08T00:00:00' and end/dateTime ge '2026-09-01T00:00:00'",
    );
  });
});

describe('nextAnchorScanProgress', () => {
  const done = { freshTruncated: false, backlogExhausted: false };

  it('records the cutoff reached and how far back the pass read', () => {
    const state = accumulateAnchorHolePage(
      initialAnchorHoleScanState,
      ends('2024-02-02T00:00:00.000Z'),
      LIMITS,
    );
    assert.deepEqual(nextAnchorScanProgress(null, CUTOFF, state, done, NOW), {
      from: '2024-02-02T00:00:00.000Z',
      to: CUTOFF,
      complete: false,
      completedAt: null,
    });
  });

  it('never forgets how deep an earlier pass reached', () => {
    const previous: AnchorScanProgress = {
      from: '2020-01-01T00:00:00.000Z',
      to: '2026-09-01T00:00:00.000Z',
      complete: false,
      completedAt: null,
    };
    const state = accumulateAnchorHolePage(
      initialAnchorHoleScanState,
      ends('2026-08-30T00:00:00.000Z'),
      LIMITS,
    );
    assert.equal(nextAnchorScanProgress(previous, CUTOFF, state, done, NOW).from, previous.from);
  });

  it('only marks a book complete on evidence the backlog ran out', () => {
    const state = accumulateAnchorHolePage(initialAnchorHoleScanState, [], LIMITS);
    assert.equal(nextAnchorScanProgress(null, CUTOFF, state, done, NOW).complete, false);
    const complete = nextAnchorScanProgress(
      null,
      CUTOFF,
      state,
      { freshTruncated: false, backlogExhausted: true },
      NOW,
    );
    assert.equal(complete.complete, true);
    assert.equal(complete.completedAt, NOW.toISOString());
  });

  it('keeps a book complete once it is, without restarting its clock', () => {
    const previous: AnchorScanProgress = {
      from: null,
      to: CUTOFF,
      complete: true,
      completedAt: '2026-09-01T00:00:00.000Z',
    };
    const state = accumulateAnchorHolePage(initialAnchorHoleScanState, [], LIMITS);
    const next = nextAnchorScanProgress(previous, CUTOFF, state, done, NOW);
    assert.equal(next.complete, true);
    assert.equal(next.completedAt, previous.completedAt);
  });

  it('claims nothing new when a cut-short pass read nothing at all', () => {    const previous: AnchorScanProgress = {
      from: '2024-01-01T00:00:00.000Z',
      to: '2026-08-01T00:00:00.000Z',
      complete: false,
      completedAt: null,
    };
    const next = nextAnchorScanProgress(
      previous,
      CUTOFF,
      initialAnchorHoleScanState,
      { freshTruncated: true, backlogExhausted: false },
      NOW,
    );
    assert.deepEqual(next, previous);
  });

  it('steps past a wall of events sharing one instant rather than stalling', () => {
    // Nothing worth collecting came back and the slice still did not reach
    // past where the last one stopped, so every pass would read the same
    // prefix of that group forever and the backlog would never move.
    const previous: AnchorScanProgress = {
      from: '2024-01-01T00:00:00.000Z',
      to: CUTOFF,
      complete: false,
      completedAt: null,
    };
    const state = accumulateAnchorHolePage(
      initialAnchorHoleScanState,
      ends('2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z'),
      LIMITS,
    );
    const next = nextAnchorScanProgress(
      previous,
      CUTOFF,
      state,
      { freshTruncated: false, backlogTruncated: true, backlogExhausted: false },
      NOW,
    );
    assert.equal(next.from, '2023-12-31T23:59:59.999Z');
  });

  it('waits rather than stepping past while the group still yields work', () => {
    // Those candidates are swept forward and leave the group, so the next
    // pass gets further into it; stepping past now would abandon the rest.
    const previous: AnchorScanProgress = {
      from: '2024-01-01T00:00:00.000Z',
      to: CUTOFF,
      complete: false,
      completedAt: null,
    };
    const state = accumulateAnchorHolePage(
      initialAnchorHoleScanState,
      [{ item: item('a'), end: '2024-01-01T00:00:00.000Z' }],
      LIMITS,
    );
    const next = nextAnchorScanProgress(
      previous,
      CUTOFF,
      state,
      { freshTruncated: false, backlogTruncated: true, backlogExhausted: false },
      NOW,
    );
    assert.equal(next.from, previous.from);
  });

  it('leaves a backlog that is making headway alone', () => {
    const previous: AnchorScanProgress = {
      from: '2024-01-01T00:00:00.000Z',
      to: CUTOFF,
      complete: false,
      completedAt: null,
    };
    const state = accumulateAnchorHolePage(
      initialAnchorHoleScanState,
      ends('2023-06-01T00:00:00.000Z'),
      LIMITS,
    );
    const next = nextAnchorScanProgress(
      previous,
      CUTOFF,
      state,
      { freshTruncated: false, backlogTruncated: true, backlogExhausted: false },
      NOW,
    );
    assert.equal(next.from, '2023-06-01T00:00:00.000Z');
  });
});

describe('refreshAnchorScanProgress', () => {
  it('carries on from a recent pass', () => {
    const progress: AnchorScanProgress = {
      from: '2024-01-01T00:00:00.000Z',
      to: CUTOFF,
      complete: false,
      completedAt: null,
    };
    assert.deepEqual(refreshAnchorScanProgress(progress, NOW), progress);
  });

  it('reads a fully-scanned book again once its scan has aged out', () => {
    // An event can be dragged back into a stretch already read, so "done" has
    // to expire or nothing would ever look there again.
    const stale: AnchorScanProgress = {
      from: null,
      to: CUTOFF,
      complete: true,
      completedAt: new Date(
        NOW.getTime() - (ANCHOR_SCAN_RECHECK_DAYS + 1) * 24 * 60 * 60 * 1000,
      ).toISOString(),
    };
    assert.equal(refreshAnchorScanProgress(stale, NOW), null);
    const fresh = { ...stale, completedAt: NOW.toISOString() };
    assert.deepEqual(refreshAnchorScanProgress(fresh, NOW), fresh);
  });

  it('starts the clock on a completion that was never stamped', () => {
    const legacy: AnchorScanProgress = {
      from: null,
      to: CUTOFF,
      complete: true,
      completedAt: null,
    };
    assert.deepEqual(refreshAnchorScanProgress(legacy, NOW), {
      ...legacy,
      completedAt: NOW.toISOString(),
    });
  });

  it('refuses progress written by a clock running ahead', () => {
    // Trusting a cutoff in the future would skip every event up to it.
    const skewed: AnchorScanProgress = {
      from: null,
      to: new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      complete: false,
      completedAt: null,
    };
    assert.equal(refreshAnchorScanProgress(skewed, NOW), null);
  });

  it('has nothing to carry on from when there is no progress', () => {
    assert.equal(refreshAnchorScanProgress(null, NOW), null);
  });
});

describe('oldestInstant', () => {
  it('ignores anything it cannot read', () => {
    assert.equal(oldestInstant(null, '2026-01-01T00:00:00.000Z'), '2026-01-01T00:00:00.000Z');
    assert.equal(oldestInstant('2026-01-01T00:00:00.000Z', 'nonsense'), '2026-01-01T00:00:00.000Z');
    assert.equal(oldestInstant(null, undefined), null);
  });
});

describe('sanitizeAnchorScanProgress', () => {
  it('accepts stored progress', () => {
    assert.deepEqual(
      sanitizeAnchorScanProgress({
        from: '2025-01-01T00:00:00.000Z',
        to: CUTOFF,
        complete: true,
        completedAt: CUTOFF,
      }),
      { from: '2025-01-01T00:00:00.000Z', to: CUTOFF, complete: true, completedAt: CUTOFF },
    );
  });

  it('drops a corrupt depth rather than resuming from nonsense', () => {
    assert.deepEqual(
      sanitizeAnchorScanProgress({ from: 'nonsense', to: CUTOFF, complete: 'yes' }),
      { from: null, to: CUTOFF, complete: false, completedAt: null },
    );
  });

  it('refuses progress with no cutoff to compare against', () => {
    assert.equal(sanitizeAnchorScanProgress({ from: CUTOFF }), null);
    assert.equal(sanitizeAnchorScanProgress('nonsense'), null);
    assert.equal(sanitizeAnchorScanProgress(null), null);
  });
});
