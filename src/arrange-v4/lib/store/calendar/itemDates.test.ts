import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveIncomingDates, resolveItemDates, resolveStoredDates } from './itemDates';

const NOW = new Date('2026-10-08T12:00:00.000Z');

describe('resolveStoredDates', () => {
  it('prefers the payload dates over the event anchor', () => {
    assert.deepEqual(
      resolveStoredDates({
        storedEts: '2026-08-01T09:00:00.000Z',
        storedEta: '2026-08-01T10:00:00.000Z',
        eventStart: '2026-10-08T09:00:00.000Z',
        eventEnd: '2026-10-08T10:00:00.000Z',
      }),
      {
        etsDateTime: '2026-08-01T09:00:00.000Z',
        etaDateTime: '2026-08-01T10:00:00.000Z',
      },
    );
  });

  it("recovers a legacy item's pre-bump dates", () => {
    assert.deepEqual(
      resolveStoredDates({
        legacyOriginalEts: '2026-08-01T09:00:00.000Z',
        legacyOriginalEta: '2026-08-01T10:00:00.000Z',
        eventStart: '2026-10-08T09:00:00.000Z',
        eventEnd: '2026-10-08T10:00:00.000Z',
        now: NOW,
      }),
      {
        etsDateTime: '2026-08-01T09:00:00.000Z',
        etaDateTime: '2026-08-01T10:00:00.000Z',
      },
    );
  });

  it('falls back to the event for an item that was never bumped', () => {
    assert.deepEqual(
      resolveStoredDates({
        eventStart: '2026-10-08T09:00:00.000Z',
        eventEnd: '2026-10-08T10:00:00.000Z',
      }),
      {
        etsDateTime: '2026-10-08T09:00:00.000Z',
        etaDateTime: '2026-10-08T10:00:00.000Z',
      },
    );
  });

  it('takes an event moved outside Arrange as the new plan', () => {
    assert.deepEqual(
      resolveStoredDates({
        storedEts: '2026-08-01T09:00:00.000Z',
        storedEta: '2026-08-01T10:00:00.000Z',
        storedAnchorStart: '2026-10-08T09:00:00.000Z',
        storedAnchorEnd: '2026-10-08T10:00:00.000Z',
        eventStart: '2026-11-02T15:00:00.000Z',
        eventEnd: '2026-11-02T16:00:00.000Z',
      }),
      {
        etsDateTime: '2026-11-02T15:00:00.000Z',
        etaDateTime: '2026-11-02T16:00:00.000Z',
      },
    );
  });

  it('keeps the planned dates while the event sits on the anchor Arrange wrote', () => {
    assert.deepEqual(
      resolveStoredDates({
        storedEts: '2026-08-01T09:00:00.000Z',
        storedEta: '2026-08-01T10:00:00.000Z',
        storedAnchorStart: '2026-10-08T09:00:00.000Z',
        storedAnchorEnd: '2026-10-08T10:00:00.000Z',
        eventStart: '2026-10-08T09:00:00Z',
        eventEnd: '2026-10-08T10:00:00Z',
      }),
      {
        etsDateTime: '2026-08-01T09:00:00.000Z',
        etaDateTime: '2026-08-01T10:00:00.000Z',
      },
    );
  });

  it('discards a half-cleared legacy pair that would run backwards', () => {
    // The old scheme cleared the two originals one at a time, so an item can
    // hold a real ETA beside an already-rescheduled ETS.
    assert.deepEqual(
      resolveStoredDates({
        legacyOriginalEta: '2026-08-01T10:00:00.000Z',
        eventStart: '2026-10-08T09:30:00.000Z',
        eventEnd: '2026-10-08T10:30:00.000Z',
      }),
      {
        etsDateTime: '2026-10-08T09:30:00.000Z',
        etaDateTime: '2026-10-08T10:30:00.000Z',
      },
    );
  });

  it('takes an Outlook reschedule of a legacy item as the new plan', () => {
    // A legacy item has no recorded anchor, so the only sign of an outside
    // move is that the event is not where bumping would have put it.
    assert.deepEqual(
      resolveStoredDates({
        legacyOriginalEts: '2026-08-01T09:00:00.000Z',
        legacyOriginalEta: '2026-08-01T10:00:00.000Z',
        eventStart: '2026-11-02T15:00:00.000Z',
        eventEnd: '2026-11-02T16:30:00.000Z',
      }),
      {
        etsDateTime: '2026-11-02T15:00:00.000Z',
        etaDateTime: '2026-11-02T16:30:00.000Z',
      },
    );
  });

  it('takes a future reschedule of a legacy item as the new plan', () => {
    // Bumping could only move an event to the day it ran, so a future date
    // that happens to share the time of day is still a reschedule.
    assert.deepEqual(
      resolveStoredDates({
        legacyOriginalEts: '2026-08-01T09:00:00.000Z',
        legacyOriginalEta: '2026-08-01T10:00:00.000Z',
        eventStart: '2026-11-02T09:00:00.000Z',
        eventEnd: '2026-11-02T10:00:00.000Z',
        now: NOW,
      }),
      {
        etsDateTime: '2026-11-02T09:00:00.000Z',
        etaDateTime: '2026-11-02T10:00:00.000Z',
      },
    );
  });

  it('keeps the plan when an old client bumped the item again', () => {
    // An older tab still bumps: it leaves the payload dates in place, writes
    // the originals back, and moves the event off the anchor. That is not a
    // reschedule and must not overwrite the plan.
    assert.deepEqual(
      resolveStoredDates({
        storedEts: '2026-10-08T09:00:00.000Z',
        storedEta: '2026-10-08T10:00:00.000Z',
        storedAnchorStart: '2026-10-07T09:00:00.000Z',
        storedAnchorEnd: '2026-10-07T10:00:00.000Z',
        legacyOriginalEts: '2026-08-01T09:00:00.000Z',
        legacyOriginalEta: '2026-08-01T10:00:00.000Z',
        eventStart: '2026-10-08T09:00:00.000Z',
        eventEnd: '2026-10-08T10:00:00.000Z',
        now: NOW,
      }),
      {
        etsDateTime: '2026-08-01T09:00:00.000Z',
        etaDateTime: '2026-08-01T10:00:00.000Z',
      },
    );
  });

  it('tolerates the backend rounding the anchor it stored', () => {
    assert.deepEqual(
      resolveStoredDates({
        storedEts: '2026-08-01T09:00:00.000Z',
        storedEta: '2026-08-01T10:00:00.000Z',
        storedAnchorStart: '2026-10-08T09:00:12.345Z',
        storedAnchorEnd: '2026-10-08T10:00:12.345Z',
        eventStart: '2026-10-08T09:00:00.0000000Z',
        eventEnd: '2026-10-08T10:00:00.0000000Z',
      }),
      {
        etsDateTime: '2026-08-01T09:00:00.000Z',
        etaDateTime: '2026-08-01T10:00:00.000Z',
      },
    );
  });
});

describe('resolveIncomingDates', () => {
  it('leaves an ordinary item alone', () => {
    assert.deepEqual(
      resolveIncomingDates({
        etsDateTime: '2026-10-08T09:00:00.000Z',
        etaDateTime: '2026-10-08T10:00:00.000Z',
      }),
      {
        etsDateTime: '2026-10-08T09:00:00.000Z',
        etaDateTime: '2026-10-08T10:00:00.000Z',
      },
    );
  });

  it('restores the pre-bump dates of a legacy item being moved in', () => {
    assert.deepEqual(
      resolveIncomingDates({
        etsDateTime: '2026-10-08T09:00:00.000Z',
        etaDateTime: '2026-10-08T10:00:00.000Z',
        originalEtsDateTime: '2026-08-01T09:00:00.000Z',
        originalEtaDateTime: '2026-08-01T10:00:00.000Z',
      }),
      {
        etsDateTime: '2026-08-01T09:00:00.000Z',
        etaDateTime: '2026-08-01T10:00:00.000Z',
      },
    );
  });

  it('ignores originals that would produce a backwards range', () => {
    assert.deepEqual(
      resolveIncomingDates({
        etsDateTime: '2026-10-08T09:30:00.000Z',
        etaDateTime: '2026-10-08T10:30:00.000Z',
        originalEtaDateTime: '2026-08-01T10:00:00.000Z',
      }),
      {
        etsDateTime: '2026-10-08T09:30:00.000Z',
        etaDateTime: '2026-10-08T10:30:00.000Z',
      },
    );
  });
});

describe('resolveItemDates', () => {
  it('anchors a stale item forward without moving its ETS/ETA', () => {
    const result = resolveItemDates({
      storedEts: '2026-08-01T09:00:00.000Z',
      storedEta: '2026-08-01T10:00:00.000Z',
      eventStart: '2026-08-01T09:00:00.000Z',
      eventEnd: '2026-08-01T10:00:00.000Z',
      status: 'new',
      now: NOW,
    });
    assert.equal(result.etsDateTime, '2026-08-01T09:00:00.000Z');
    assert.equal(result.etaDateTime, '2026-08-01T10:00:00.000Z');
    assert.equal(result.anchorStart, '2026-10-08T09:00:00.000Z');
    assert.equal(result.anchorEnd, '2026-10-08T10:00:00.000Z');
  });

  it('writes no anchor when the event already sits where it should', () => {
    const result = resolveItemDates({
      storedEts: '2026-08-01T09:00:00.000Z',
      storedEta: '2026-08-01T10:00:00.000Z',
      eventStart: '2026-10-08T09:00:00Z',
      eventEnd: '2026-10-08T10:00:00Z',
      status: 'inProgress',
      now: NOW,
    });
    assert.equal(result.anchorStart, undefined);
    assert.equal(result.anchorEnd, undefined);
  });

  it('migrates a legacy bumped item back to its planned dates', () => {
    const result = resolveItemDates({
      legacyOriginalEts: '2026-09-20T08:00:00.000Z',
      legacyOriginalEta: '2026-09-20T09:00:00.000Z',
      eventStart: '2026-10-08T08:00:00.000Z',
      eventEnd: '2026-10-08T09:00:00.000Z',
      status: 'new',
      now: NOW,
    });
    assert.equal(result.etsDateTime, '2026-09-20T08:00:00.000Z');
    assert.equal(result.etaDateTime, '2026-09-20T09:00:00.000Z');
    // The anchor it already has is exactly where it belongs.
    assert.equal(result.anchorStart, undefined);
  });

  it('keeps a caller-supplied reschedule and anchors it when stale', () => {
    const result = resolveItemDates({
      storedEts: '2026-10-09T09:00:00.000Z',
      storedEta: '2026-10-09T10:00:00.000Z',
      eventStart: '2026-10-09T09:00:00.000Z',
      eventEnd: '2026-10-09T10:00:00.000Z',
      updatedEts: '2026-07-01T14:00:00.000Z',
      updatedEta: '2026-07-01T15:00:00.000Z',
      status: 'new',
      now: NOW,
    });
    assert.equal(result.etsDateTime, '2026-07-01T14:00:00.000Z');
    assert.equal(result.etaDateTime, '2026-07-01T15:00:00.000Z');
    assert.equal(result.anchorStart, '2026-10-08T14:00:00.000Z');
    assert.equal(result.anchorEnd, '2026-10-08T15:00:00.000Z');
  });

  it('moves a future reschedule onto the event itself', () => {
    const result = resolveItemDates({
      storedEts: '2026-08-01T09:00:00.000Z',
      storedEta: '2026-08-01T10:00:00.000Z',
      eventStart: '2026-10-08T09:00:00.000Z',
      eventEnd: '2026-10-08T10:00:00.000Z',
      updatedEts: '2026-10-20T09:00:00.000Z',
      updatedEta: '2026-10-20T10:00:00.000Z',
      status: 'blocked',
      now: NOW,
    });
    assert.equal(result.anchorStart, '2026-10-20T09:00:00.000Z');
    assert.equal(result.anchorEnd, '2026-10-20T10:00:00.000Z');
  });

  it('leaves a terminal item where it is so it stays in the window', () => {
    const result = resolveItemDates({
      storedEts: '2026-08-01T09:00:00.000Z',
      storedEta: '2026-08-01T10:00:00.000Z',
      eventStart: '2026-10-08T09:00:00.000Z',
      eventEnd: '2026-10-08T10:00:00.000Z',
      status: 'finished',
      now: NOW,
    });
    assert.equal(result.etsDateTime, '2026-08-01T09:00:00.000Z');
    // Moving it back to a plan made months ago would drop it out of the
    // ±30-day fetch and out of the Finished lane the moment it is finished.
    assert.equal(result.anchorStart, undefined);
    assert.equal(result.anchorEnd, undefined);
    assert.equal(result.storedAnchorStart, '2026-10-08T09:00:00.000Z');
  });

  it('writes nothing for a terminal item the caller did not edit', () => {
    const result = resolveItemDates({
      storedEts: '2026-08-01T09:00:00.000Z',
      storedEta: '2026-08-01T10:00:00.000Z',
      eventStart: '2026-08-01T09:00:00.000Z',
      eventEnd: '2026-08-01T10:00:00.000Z',
      status: 'cancelled',
      now: NOW,
    });
    assert.equal(result.anchorStart, undefined);
    assert.equal(result.anchorEnd, undefined);
  });

  it("records a terminal item's edited dates without moving the event", () => {
    const result = resolveItemDates({
      storedEts: '2026-08-01T09:00:00.000Z',
      storedEta: '2026-08-01T10:00:00.000Z',
      eventStart: '2026-09-15T09:00:00.000Z',
      eventEnd: '2026-09-15T10:00:00.000Z',
      updatedEts: '2026-08-02T09:00:00.000Z',
      status: 'cancelled',
      now: NOW,
    });
    assert.equal(result.etsDateTime, '2026-08-02T09:00:00.000Z');
    assert.equal(result.anchorStart, undefined);
    assert.equal(result.anchorEnd, undefined);
  });

  it('leaves the anchor alone when the dates cannot be anchored', () => {
    const result = resolveItemDates({
      storedEts: '2026-08-01T10:00:00.000Z',
      storedEta: '2026-08-01T09:00:00.000Z',
      eventStart: '2026-10-08T10:00:00.000Z',
      eventEnd: '2026-10-08T11:00:00.000Z',
      status: 'new',
      now: NOW,
    });
    assert.equal(result.anchorStart, undefined);
    assert.equal(result.anchorEnd, undefined);
  });
});
