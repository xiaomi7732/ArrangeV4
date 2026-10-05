import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SPAN_MS,
  MIN_SPAN_MS,
  barGeometry,
  buildTimeAxisTicks,
  centerWindowOn,
  clampSpan,
  createWindow,
  defaultWindow,
  describeWindow,
  fetchRangeFor,
  granularityFor,
  panWindow,
  positionPercent,
  spanOf,
  zoomWindow,
} from './timelineWindow';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** A window over a plain, DST-free stretch of days. */
function windowOf(startMs: number, spanMs: number) {
  return { startMs, endMs: startMs + spanMs };
}

const BASE = new Date(2026, 2, 10, 0, 0, 0).getTime();

/**
 * Runs a check in a zone that really observes daylight saving, so the clock-change
 * tests mean something on a machine (or CI runner) set to UTC.
 *
 * The override is global to the process, but it cannot leak: `node --test` runs
 * every test file in its own child process, `run` is synchronous, and the
 * previous value is restored in `finally`.
 */
function inTimeZone(timeZone: string, run: () => void): void {
  const previous = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    // Proves the override took effect; otherwise the assertions below pass vacuously.
    const offsetChanges =
      new Date(2026, 0, 1).getTimezoneOffset() !== new Date(2026, 6, 1).getTimezoneOffset();
    if (!offsetChanges) return;
    run();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

describe('clampSpan', () => {
  test('keeps a sensible span untouched', () => {
    assert.equal(clampSpan(14 * DAY), 14 * DAY);
  });

  test('refuses to zoom in past the minimum', () => {
    assert.equal(clampSpan(MIN_SPAN_MS / 10), MIN_SPAN_MS);
  });

  test('refuses to zoom out past the maximum', () => {
    assert.equal(clampSpan(MAX_SPAN_MS * 10), MAX_SPAN_MS);
  });

  test('falls back to the minimum for a nonsense span', () => {
    assert.equal(clampSpan(0), MIN_SPAN_MS);
    assert.equal(clampSpan(-DAY), MIN_SPAN_MS);
    assert.equal(clampSpan(NaN), MIN_SPAN_MS);
  });
});

describe('createWindow', () => {
  test('centres the span on the given instant', () => {
    const w = createWindow(BASE, 10 * DAY);
    assert.equal(spanOf(w), 10 * DAY);
    assert.equal(w.startMs + spanOf(w) / 2, BASE);
  });
});

describe('defaultWindow', () => {
  test('starts before today and runs well past it', () => {
    const now = new Date(2026, 5, 10, 15, 30);
    const w = defaultWindow(now);
    assert.ok(w.startMs < now.getTime());
    assert.ok(w.endMs > now.getTime());
    assert.equal(spanOf(w), 14 * DAY);
  });

  test('snaps to the start of the local day, even across a clock change', () => {
    // March 2026 contains a spring-forward in much of the world.
    for (const now of [new Date(2026, 2, 10, 15, 30), new Date(2026, 10, 3, 15, 30)]) {
      const w = defaultWindow(now);
      for (const edge of [new Date(w.startMs), new Date(w.endMs)]) {
        assert.equal(edge.getHours(), 0);
        assert.equal(edge.getMinutes(), 0);
      }
    }
  });
});

describe('zoomWindow', () => {
  test('zooming in halves the span', () => {
    const w = zoomWindow(windowOf(BASE, 20 * DAY), 0.5);
    assert.equal(spanOf(w), 10 * DAY);
  });

  test('zooming out doubles the span', () => {
    const w = zoomWindow(windowOf(BASE, 10 * DAY), 2);
    assert.equal(spanOf(w), 20 * DAY);
  });

  test('holds the centre still by default', () => {
    const before = windowOf(BASE, 20 * DAY);
    const center = before.startMs + spanOf(before) / 2;
    const after = zoomWindow(before, 0.5);
    assert.equal(after.startMs + spanOf(after) / 2, center);
  });

  test('holds the anchored instant still', () => {
    const before = windowOf(BASE, 20 * DAY);
    const anchorRatio = 0.25;
    const anchorMs = before.startMs + spanOf(before) * anchorRatio;
    const after = zoomWindow(before, 0.5, anchorRatio);
    assert.equal(after.startMs + spanOf(after) * anchorRatio, anchorMs);
  });

  test('still holds the anchor when the span is clamped', () => {
    const before = windowOf(BASE, MIN_SPAN_MS * 2);
    const anchorRatio = 0.75;
    const anchorMs = before.startMs + spanOf(before) * anchorRatio;
    const after = zoomWindow(before, 0.01, anchorRatio);
    assert.equal(spanOf(after), MIN_SPAN_MS);
    assert.equal(after.startMs + spanOf(after) * anchorRatio, anchorMs);
  });

  test('clamps an anchor outside the chart to its edges', () => {
    const before = windowOf(BASE, 20 * DAY);
    assert.deepEqual(zoomWindow(before, 0.5, -1), zoomWindow(before, 0.5, 0));
    assert.deepEqual(zoomWindow(before, 0.5, 2), zoomWindow(before, 0.5, 1));
  });

  test('zooming in then out returns to where it started', () => {
    const before = windowOf(BASE, 20 * DAY);
    const round = zoomWindow(zoomWindow(before, 0.5, 0.3), 2, 0.3);
    assert.equal(round.startMs, before.startMs);
    assert.equal(round.endMs, before.endMs);
  });
});

describe('panWindow', () => {
  test('moves forward without changing the zoom', () => {
    const before = windowOf(BASE, 10 * DAY);
    const after = panWindow(before, 0.5);
    assert.equal(spanOf(after), spanOf(before));
    assert.equal(after.startMs, before.startMs + 5 * DAY);
  });

  test('moves backward for a negative delta', () => {
    const before = windowOf(BASE, 10 * DAY);
    assert.equal(panWindow(before, -0.5).startMs, before.startMs - 5 * DAY);
  });

  test('pans further when zoomed out, so the gesture feels the same', () => {
    const narrow = panWindow(windowOf(BASE, DAY), 0.25);
    const wide = panWindow(windowOf(BASE, 100 * DAY), 0.25);
    assert.ok(wide.startMs - BASE > narrow.startMs - BASE);
  });
});

describe('centerWindowOn', () => {
  test('re-centres without changing the zoom', () => {
    const before = windowOf(BASE, 10 * DAY);
    const after = centerWindowOn(before, BASE + 100 * DAY);
    assert.equal(spanOf(after), spanOf(before));
    assert.equal(after.startMs + spanOf(after) / 2, BASE + 100 * DAY);
  });
});

describe('positionPercent', () => {
  test('maps the edges to 0 and 100', () => {
    const w = windowOf(BASE, 10 * DAY);
    assert.equal(positionPercent(w.startMs, w), 0);
    assert.equal(positionPercent(w.endMs, w), 100);
  });

  test('maps the midpoint to 50', () => {
    const w = windowOf(BASE, 10 * DAY);
    assert.equal(positionPercent(BASE + 5 * DAY, w), 50);
  });

  test('reports instants outside the window beyond the edges', () => {
    const w = windowOf(BASE, 10 * DAY);
    assert.ok(positionPercent(BASE - DAY, w) < 0);
    assert.ok(positionPercent(BASE + 11 * DAY, w) > 100);
  });
});

describe('barGeometry', () => {
  const w = windowOf(BASE, 10 * DAY);

  test('places a fully visible bar', () => {
    const bar = barGeometry(BASE + 2 * DAY, BASE + 4 * DAY, w);
    assert.ok(bar);
    assert.equal(bar.leftPercent, 20);
    assert.equal(bar.widthPercent, 20);
    assert.equal(bar.clippedStart, false);
    assert.equal(bar.clippedEnd, false);
  });

  test('clips a bar that starts before the window', () => {
    const bar = barGeometry(BASE - 5 * DAY, BASE + 2 * DAY, w);
    assert.ok(bar);
    assert.equal(bar.leftPercent, 0);
    assert.equal(bar.widthPercent, 20);
    assert.equal(bar.clippedStart, true);
    assert.equal(bar.clippedEnd, false);
  });

  test('clips a bar that runs past the window', () => {
    const bar = barGeometry(BASE + 8 * DAY, BASE + 50 * DAY, w);
    assert.ok(bar);
    assert.equal(bar.leftPercent, 80);
    assert.equal(bar.widthPercent, 20);
    assert.equal(bar.clippedEnd, true);
  });

  test('clips a bar that swallows the whole window at both ends', () => {
    const bar = barGeometry(BASE - 50 * DAY, BASE + 50 * DAY, w);
    assert.ok(bar);
    assert.equal(bar.leftPercent, 0);
    assert.equal(bar.widthPercent, 100);
    assert.equal(bar.clippedStart, true);
    assert.equal(bar.clippedEnd, true);
  });

  test('drops a bar entirely in the past or the future', () => {
    assert.equal(barGeometry(BASE - 10 * DAY, BASE - 5 * DAY, w), null);
    assert.equal(barGeometry(BASE + 20 * DAY, BASE + 25 * DAY, w), null);
  });

  test('keeps a bar that reaches the inclusive left edge', () => {
    assert.ok(barGeometry(BASE - 5 * DAY, BASE, w));
  });

  test('drops a task that only begins where the window ends', () => {
    // The right edge is exclusive, so this task belongs to the next period.
    assert.equal(barGeometry(w.endMs, w.endMs + 5 * DAY, w), null);
    assert.ok(barGeometry(w.endMs - 1, w.endMs + 5 * DAY, w));
  });

  test('treats a one-sided task as an instant rather than hiding it', () => {
    const onlyEnd = barGeometry(null, BASE + 5 * DAY, w);
    assert.ok(onlyEnd);
    assert.equal(onlyEnd.leftPercent, 50);
    assert.equal(onlyEnd.widthPercent, 0);

    const onlyStart = barGeometry(BASE + 5 * DAY, null, w);
    assert.ok(onlyStart);
    assert.equal(onlyStart.leftPercent, 50);
  });

  test('shows a task with no dates at all nowhere', () => {
    assert.equal(barGeometry(null, null, w), null);
  });

  test('straightens a reversed range instead of discarding it', () => {
    const bar = barGeometry(BASE + 4 * DAY, BASE + 2 * DAY, w);
    assert.ok(bar);
    assert.equal(bar.leftPercent, 20);
    assert.equal(bar.widthPercent, 20);
  });

  test('ignores an unparseable date on one side', () => {
    const bar = barGeometry(NaN, BASE + 5 * DAY, w);
    assert.ok(bar);
    assert.equal(bar.leftPercent, 50);
  });
});

describe('granularityFor', () => {
  test('uses hours for a day or two', () => {
    assert.equal(granularityFor(windowOf(BASE, DAY)), 'hour');
  });

  test('uses days for a couple of weeks', () => {
    assert.equal(granularityFor(windowOf(BASE, 14 * DAY)), 'day');
  });

  test('uses weeks for a few months', () => {
    assert.equal(granularityFor(windowOf(BASE, 100 * DAY)), 'week');
  });

  test('uses months for a year', () => {
    assert.equal(granularityFor(windowOf(BASE, 365 * DAY)), 'month');
  });
});

describe('buildTimeAxisTicks', () => {
  test('returns nothing for an empty window', () => {
    assert.deepEqual(buildTimeAxisTicks({ startMs: BASE, endMs: BASE }), []);
  });

  test('leaves out a tick that lands exactly on the exclusive end', () => {
    // Midnight-to-midnight windows at every granularity: the closing midnight
    // is not in view, so it must not be labelled.
    for (const days of [1, 10, 60, 400]) {
      const start = new Date(2024, 4, 1).getTime();
      const end = new Date(2024, 4, 1 + days).getTime();
      for (const tick of buildTimeAxisTicks({ startMs: start, endMs: end })) {
        assert.ok(tick.timeMs < end, `tick at the exclusive end for ${days} days`);
        assert.ok(tick.positionPercent < 100, `tick on the right edge for ${days} days`);
      }
    }
  });

  test('puts every tick inside the window', () => {
    for (const span of [DAY, 14 * DAY, 100 * DAY, 365 * DAY]) {
      const w = windowOf(BASE, span);
      for (const tick of buildTimeAxisTicks(w)) {
        assert.ok(tick.positionPercent >= 0 && tick.positionPercent <= 100,
          `tick out of range for span ${span}: ${tick.positionPercent}`);
      }
    }
  });

  test('produces a readable number of labels at every zoom', () => {
    for (const span of [MIN_SPAN_MS, DAY, 14 * DAY, 100 * DAY, MAX_SPAN_MS]) {
      const count = buildTimeAxisTicks(windowOf(BASE, span)).length;
      assert.ok(count > 0 && count <= 60, `got ${count} ticks for span ${span}`);
    }
  });

  test('keeps ticks in ascending order', () => {
    const ticks = buildTimeAxisTicks(windowOf(BASE, 14 * DAY));
    for (let i = 1; i < ticks.length; i++) {
      assert.ok(ticks[i].timeMs > ticks[i - 1].timeMs);
    }
  });

  test('lands day ticks on local midnight', () => {
    for (const tick of buildTimeAxisTicks(windowOf(BASE, 14 * DAY))) {
      const d = new Date(tick.timeMs);
      assert.equal(d.getHours(), 0);
      assert.equal(d.getMinutes(), 0);
    }
  });

  test('marks the first of the month as major on a day scale', () => {
    const start = new Date(2026, 2, 25).getTime();
    const ticks = buildTimeAxisTicks(windowOf(start, 14 * DAY));
    const major = ticks.filter((t) => t.major);
    assert.equal(major.length, 1);
    assert.equal(new Date(major[0].timeMs).getDate(), 1);
  });

  test('lands month ticks on the first of each month', () => {
    const ticks = buildTimeAxisTicks(windowOf(BASE, 365 * DAY));
    assert.ok(ticks.length > 6);
    for (const tick of ticks) {
      assert.equal(new Date(tick.timeMs).getDate(), 1);
    }
  });

  test('anchors week ticks to Mondays so panning does not shift the labels', () => {
    const ticks = buildTimeAxisTicks(windowOf(BASE, 100 * DAY));
    for (const tick of ticks) {
      assert.equal(new Date(tick.timeMs).getDay(), 1);
    }
    // Shifting the window by a day must not move the labels with it.
    const shifted = buildTimeAxisTicks(windowOf(BASE + DAY, 100 * DAY));
    const shared = new Set(shifted.map(t => t.timeMs));
    const overlap = ticks.filter(t => shared.has(t.timeMs));
    assert.ok(overlap.length >= ticks.length - 1);
  });

  test('spaces week ticks seven calendar days apart, clock changes included', () => {
    const ticks = buildTimeAxisTicks(windowOf(BASE, 100 * DAY));
    assert.ok(ticks.length > 2);
    for (let i = 1; i < ticks.length; i++) {
      // Not 7 * 24h: a week containing a daylight-saving change is 167 or 169
      // hours long, and the ticks must follow the calendar rather than the clock.
      const previous = new Date(ticks[i - 1].timeMs);
      const expected = new Date(
        previous.getFullYear(),
        previous.getMonth(),
        previous.getDate() + 7,
      );
      assert.equal(ticks[i].timeMs, expected.getTime());
      assert.equal(new Date(ticks[i].timeMs).getHours(), 0);
    }
  });

  test('never repeats an hour tick on a spring-forward day', () => {
    // 2am does not exist that morning in US zones: asking for it yields 3am,
    // which would duplicate the real 3am tick — and the React key drawn with it.
    inTimeZone('America/Los_Angeles', () => {
      for (const spanMs of [6 * HOUR, 8 * HOUR, 14 * HOUR, DAY]) {
        const start = new Date(2026, 2, 8).getTime();
        const ticks = buildTimeAxisTicks({ startMs: start, endMs: start + spanMs });
        const seen = new Set<number>();
        for (const tick of ticks) {
          assert.ok(!seen.has(tick.timeMs), `duplicate tick at ${tick.label} over ${spanMs}ms`);
          seen.add(tick.timeMs);
        }
        for (let i = 1; i < ticks.length; i++) {
          assert.ok(ticks[i].timeMs > ticks[i - 1].timeMs);
        }
      }
    });
  });

  test('keeps hour ticks on whole step hours across a spring-forward day', () => {
    // 2am does not exist on a spring-forward day in many zones, so a tick
    // built by adding to the previous one would drift onto odd hours.
    const start = new Date(2026, 2, 8).getTime();
    const ticks = buildTimeAxisTicks({ startMs: start, endMs: start + 2 * DAY });
    const hours = ticks.map(t => new Date(t.timeMs).getHours());
    const step = Math.min(...hours.filter(h => h > 0));
    for (const hour of hours) {
      assert.equal(hour % step, 0, `tick at ${hour}:00 is not a multiple of ${step}`);
    }
  });

  test('labels midnight with the date on an hour scale', () => {
    const ticks = buildTimeAxisTicks(windowOf(BASE, DAY));
    const midnight = ticks.find((t) => new Date(t.timeMs).getHours() === 0);
    assert.ok(midnight);
    assert.equal(midnight.major, true);
    assert.ok(midnight.label.length > 0);
  });

  test('gives every tick a label', () => {
    for (const span of [DAY, 14 * DAY, 100 * DAY, 365 * DAY]) {
      for (const tick of buildTimeAxisTicks(windowOf(BASE, span))) {
        assert.ok(tick.label.length > 0);
      }
    }
  });
});

describe('describeWindow', () => {
  test('names both ends of the range', () => {
    const text = describeWindow(windowOf(BASE, 14 * DAY));
    assert.ok(text.includes('–'));
    assert.ok(text.length > 5);
  });
});

describe('fetchRangeFor', () => {
  test('asks for more than it shows, so panning is not blank', () => {
    const w = windowOf(BASE, 14 * DAY);
    const range = fetchRangeFor(w);
    assert.ok(range.startMs < w.startMs);
    assert.ok(range.endMs > w.endMs);
  });

  test('snaps to whole local days so small nudges do not refetch', () => {
    const range = fetchRangeFor(windowOf(BASE, 14 * DAY));
    assert.equal(new Date(range.startMs).getHours(), 0);
    assert.equal(new Date(range.endMs).getHours(), 0);
  });

  test('grows with the window, so zooming out reaches further', () => {
    const narrow = fetchRangeFor(windowOf(BASE, 7 * DAY));
    const wide = fetchRangeFor(windowOf(BASE, 200 * DAY));
    assert.ok(wide.endMs - wide.startMs > narrow.endMs - narrow.startMs);
  });
});
