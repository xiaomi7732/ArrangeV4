import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  differenceInLocalCalendarDays,
  formatAbsoluteDateTime,
  formatRelativeDate,
  isDateToday,
} from './dateUtils';

describe('local calendar date handling', () => {
  const originalTimeZone = process.env.TZ;

  before(() => {
    process.env.TZ = 'America/Los_Angeles';
  });

  after(() => {
    if (originalTimeZone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimeZone;
    }
  });

  it('treats the next local day as tomorrow even when UTC dates match', () => {
    const now = new Date('2026-09-29T06:30:00Z');
    const target = '2026-09-29T07:15:00Z';

    assert.equal(isDateToday(target, now), false);
    assert.equal(formatRelativeDate(target, now).text, 'tomorrow');
  });

  it('treats the same local day as today when UTC dates differ', () => {
    const now = new Date('2026-09-29T00:30:00Z');
    const target = '2026-09-28T23:30:00Z';

    assert.equal(isDateToday(target, now), true);
    assert.equal(formatRelativeDate(target, now).text, 'today');
  });

  it('counts calendar days rather than 24-hour periods across daylight saving', () => {
    const beforeSpringForward = new Date('2026-03-08T09:30:00Z');
    const afterSpringForward = new Date('2026-03-09T07:30:00Z');

    assert.equal(
      differenceInLocalCalendarDays(afterSpringForward, beforeSpringForward),
      1,
    );
  });

  it('preserves invalid-date fallbacks', () => {
    assert.equal(isDateToday('not-a-date'), false);
    assert.equal(formatAbsoluteDateTime('not-a-date'), 'not-a-date');
    assert.deepEqual(formatRelativeDate('not-a-date'), {
      text: 'not-a-date',
      isOverdue: false,
      fullDate: 'not-a-date',
    });
  });

  it('spells absolute dates the same way everywhere', () => {
    const absolute = formatAbsoluteDateTime('2026-09-30T18:23:00Z');

    assert.equal(absolute, 'Sep 30, 2026, 11:23 AM');
    // Tooltips and detail views must not disagree about the same instant.
    assert.equal(formatRelativeDate('2026-09-30T18:23:00Z').fullDate, absolute);
  });
});
