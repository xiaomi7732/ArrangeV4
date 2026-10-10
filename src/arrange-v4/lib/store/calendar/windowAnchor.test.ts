import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeWindowAnchor, isWindowAnchorStale, isSameInstant, isNearlySameInstant, anchorZoneRanges } from './windowAnchor';

const NOW = new Date('2026-10-08T12:00:00.000Z');

describe('computeWindowAnchor', () => {
  it('leaves current dates where they are', () => {
    const anchor = computeWindowAnchor(
      '2026-10-08T09:00:00.000Z',
      '2026-10-08T10:30:00.000Z',
      NOW,
    );
    assert.deepEqual(anchor, {
      start: '2026-10-08T09:00:00.000Z',
      end: '2026-10-08T10:30:00.000Z',
    });
  });

  it('rolls a stale anchor to today keeping time of day and duration', () => {
    const anchor = computeWindowAnchor(
      '2026-08-01T17:15:00.000Z',
      '2026-08-01T18:45:00.000Z',
      NOW,
    );
    assert.deepEqual(anchor, {
      start: '2026-10-08T17:15:00.000Z',
      end: '2026-10-08T18:45:00.000Z',
    });
  });

  it('leaves future dates alone', () => {
    const anchor = computeWindowAnchor(
      '2026-11-01T08:00:00.000Z',
      '2026-11-01T09:00:00.000Z',
      NOW,
    );
    assert.equal(anchor?.start, '2026-11-01T08:00:00.000Z');
  });

  it('returns null for missing, invalid or non-positive ranges', () => {
    assert.equal(computeWindowAnchor(undefined, '2026-10-08T10:00:00.000Z', NOW), null);
    assert.equal(computeWindowAnchor('2026-10-08T10:00:00.000Z', null, NOW), null);
    assert.equal(computeWindowAnchor('nonsense', '2026-10-08T10:00:00.000Z', NOW), null);
    assert.equal(
      computeWindowAnchor('2026-08-01T10:00:00.000Z', '2026-08-01T10:00:00.000Z', NOW),
      null,
    );
  });
});

describe('isWindowAnchorStale', () => {
  it('is stale only before the start of today', () => {
    assert.equal(isWindowAnchorStale('2026-10-07T23:59:59.000Z', NOW), true);
    assert.equal(isWindowAnchorStale('2026-10-08T00:00:00.000Z', NOW), false);
    assert.equal(isWindowAnchorStale('2026-10-08T23:00:00.000Z', NOW), false);
    assert.equal(isWindowAnchorStale('2026-12-01T00:00:00.000Z', NOW), false);
  });

  it('treats an unusable anchor as not stale', () => {
    assert.equal(isWindowAnchorStale(undefined, NOW), false);
    assert.equal(isWindowAnchorStale(null, NOW), false);
    assert.equal(isWindowAnchorStale('nonsense', NOW), false);
  });
});

describe('isSameInstant', () => {
  it('ignores ISO spelling differences', () => {
    assert.equal(isSameInstant('2026-10-08T09:00:00Z', '2026-10-08T09:00:00.000Z'), true);
    assert.equal(isSameInstant('2026-10-08T11:00:00+02:00', '2026-10-08T09:00:00.000Z'), true);
  });

  it('is false when either side is missing or unusable', () => {
    assert.equal(isSameInstant(null, '2026-10-08T09:00:00.000Z'), false);
    assert.equal(isSameInstant('nonsense', '2026-10-08T09:00:00.000Z'), false);
    assert.equal(isSameInstant(null, undefined), true);
  });
});

describe('anchorZoneRanges', () => {
  it('merges a period that overlaps the anchor zone', () => {
    const ranges = anchorZoneRanges('2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', NOW);
    assert.deepEqual(ranges, [{
      fromDate: '2026-09-08T00:00:00.000Z',
      toDate: '2026-11-01T00:00:00.000Z',
    }]);
  });

  it('queries a far past period separately from the anchor zone', () => {
    const ranges = anchorZoneRanges('2026-07-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', NOW);
    assert.deepEqual(ranges, [
      { fromDate: '2026-07-01T00:00:00.000Z', toDate: '2026-08-01T00:00:00.000Z' },
      { fromDate: '2026-09-08T00:00:00.000Z', toDate: '2026-10-09T00:00:00.000Z' },
    ]);
  });

  it('queries a far future period separately, zone first', () => {
    const ranges = anchorZoneRanges('2027-01-01T00:00:00.000Z', '2027-02-01T00:00:00.000Z', NOW);
    assert.deepEqual(ranges, [
      { fromDate: '2026-09-08T00:00:00.000Z', toDate: '2026-10-09T00:00:00.000Z' },
      { fromDate: '2027-01-01T00:00:00.000Z', toDate: '2027-02-01T00:00:00.000Z' },
    ]);
  });

  it('leaves a period that already covers the anchor zone alone', () => {
    const from = '2026-01-01T00:00:00.000Z';
    const to = '2027-01-01T00:00:00.000Z';
    assert.deepEqual(anchorZoneRanges(from, to, NOW), [{ fromDate: from, toDate: to }]);
  });

  it('passes unusable dates through untouched', () => {
    assert.deepEqual(
      anchorZoneRanges('nonsense', 'also nonsense', NOW),
      [{ fromDate: 'nonsense', toDate: 'also nonsense' }],
    );
  });
});

describe('isNearlySameInstant', () => {
  it('tolerates the storage backend rounding an anchor', () => {
    assert.equal(
      isNearlySameInstant('2026-10-08T09:00:12.345Z', '2026-10-08T09:00:00.0000000Z'),
      true,
    );
  });

  it('still reports a real reschedule', () => {
    assert.equal(
      isNearlySameInstant('2026-10-08T09:00:00.000Z', '2026-10-08T15:00:00.000Z'),
      false,
    );
  });
});
