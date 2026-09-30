import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { describeDateBump } from './bumpNotice';

describe('describeDateBump', () => {
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

  it('says nothing when the dates were never moved', () => {
    assert.equal(describeDateBump({}), null);
    assert.equal(
      describeDateBump({ originalEtsDateTime: null, originalEtaDateTime: null }),
      null,
    );
  });

  it('describes a bumped start and end together', () => {
    const notice = describeDateBump({
      originalEtsDateTime: '2026-09-10T17:00:00Z',
      originalEtaDateTime: '2026-09-11T17:00:00Z',
    });

    assert.ok(notice);
    assert.equal(notice.text, 'Sep 10 → Sep 11');
    assert.match(notice.tooltip, /^Originally planned for ETS Sep 10, 2026, 10:00 AM, ETA Sep 11, 2026, 10:00 AM\./);
    assert.match(notice.tooltip, /moved these dates forward/);
  });

  it('describes a bumped start on its own', () => {
    const notice = describeDateBump({ originalEtsDateTime: '2026-09-29T17:00:00Z' });

    assert.ok(notice);
    assert.equal(notice.text, 'Sep 29');
    assert.match(notice.tooltip, /ETS Sep 29, 2026, 10:00 AM/);
    assert.doesNotMatch(notice.tooltip, /ETA/);
  });

  it('describes a bumped end on its own', () => {
    const notice = describeDateBump({ originalEtaDateTime: '2026-09-29T17:00:00Z' });

    assert.ok(notice);
    assert.equal(notice.text, 'Sep 29');
    assert.match(notice.tooltip, /ETA Sep 29, 2026, 10:00 AM/);
    assert.doesNotMatch(notice.tooltip, /ETS/);
  });
});
