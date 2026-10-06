import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  msPerPixel,
  nudgeStep,
  resizeBar,
  snapStepFor,
  snapToStep,
} from './timelineDrag';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Runs a check in a zone that really observes daylight saving, so the
 * clock-change tests mean something on a machine set to UTC.
 *
 * The override is global to the process, but it cannot leak: `node --test`
 * runs every test file in its own child process, `run` is synchronous, and the
 * previous value is restored in `finally`.
 */
function inTimeZone(timeZone: string, run: () => void): void {
  const previous = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    // Proves the override took effect; otherwise the assertions pass vacuously.
    const offsetChanges =
      new Date(2026, 0, 1).getTimezoneOffset() !== new Date(2026, 6, 1).getTimezoneOffset();
    if (!offsetChanges) return;
    run();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

describe('snapStepFor', () => {
  test('offers minutes when a day or two is in view', () => {
    assert.equal(snapStepFor(6 * HOUR), 5 * MINUTE);
    assert.equal(snapStepFor(2 * DAY), 5 * MINUTE);
  });

  test('coarsens as the window widens', () => {
    assert.equal(snapStepFor(7 * DAY), 15 * MINUTE);
    assert.equal(snapStepFor(30 * DAY), HOUR);
    assert.equal(snapStepFor(200 * DAY), DAY);
  });

  test('never gets finer as the window grows', () => {
    let previous = 0;
    for (const days of [0.25, 1, 2, 5, 10, 20, 45, 90, 400]) {
      const step = snapStepFor(days * DAY);
      assert.ok(step >= previous, `step shrank at ${days} days`);
      previous = step;
    }
  });
});

describe('snapToStep', () => {
  test('rounds to the nearest step', () => {
    const base = new Date(2026, 2, 10, 9, 7).getTime();
    assert.equal(snapToStep(base, 15 * MINUTE), new Date(2026, 2, 10, 9, 0).getTime());
    assert.equal(
      snapToStep(new Date(2026, 2, 10, 9, 23).getTime(), 15 * MINUTE),
      new Date(2026, 2, 10, 9, 30).getTime(),
    );
  });

  test('lands on the local midnight when the step is a day', () => {
    const snapped = snapToStep(new Date(2026, 2, 10, 3, 0).getTime(), DAY);
    assert.equal(snapped, new Date(2026, 2, 10, 0, 0).getTime());
  });

  test('leaves the time alone for a nonsense step', () => {
    const base = new Date(2026, 2, 10, 9, 7).getTime();
    assert.equal(snapToStep(base, 0), base);
    assert.equal(snapToStep(base, -5), base);
  });

  test('still lands on midnight on the days the clocks change', () => {
    inTimeZone('America/Los_Angeles', () => {
      // Spring forward: that local day is only 23 hours long.
      assert.equal(
        snapToStep(new Date(2026, 2, 8, 18, 0).getTime(), DAY),
        new Date(2026, 2, 9, 0, 0).getTime(),
      );
      // Fall back: 25 hours long.
      assert.equal(
        snapToStep(new Date(2026, 10, 1, 18, 0).getTime(), DAY),
        new Date(2026, 10, 2, 0, 0).getTime(),
      );
      assert.equal(
        snapToStep(new Date(2026, 10, 1, 4, 0).getTime(), DAY),
        new Date(2026, 10, 1, 0, 0).getTime(),
      );
    });
  });

  test('a whole-day drag across a clock change keeps the time of day', () => {
    inTimeZone('America/Los_Angeles', () => {
      const next = resizeBar({
        startMs: new Date(2026, 10, 1, 0, 0).getTime(),
        endMs: new Date(2026, 10, 1, 0, 0).getTime(),
        edge: 'end',
        deltaMs: DAY,
        stepMs: DAY,
      });
      assert.equal(next.endMs, new Date(2026, 10, 2, 0, 0).getTime());
    });
  });
});

describe('resizeBar', () => {
  const start = new Date(2026, 2, 10, 9, 0).getTime();
  const end = new Date(2026, 2, 12, 17, 0).getTime();

  test('moves the start and leaves the end alone', () => {
    const next = resizeBar({ startMs: start, endMs: end, edge: 'start', deltaMs: HOUR, stepMs: HOUR });
    assert.equal(next.startMs, start + HOUR);
    assert.equal(next.endMs, end);
  });

  test('moves the end and leaves the start alone', () => {
    const next = resizeBar({ startMs: start, endMs: end, edge: 'end', deltaMs: -2 * HOUR, stepMs: HOUR });
    assert.equal(next.startMs, start);
    assert.equal(next.endMs, end - 2 * HOUR);
  });

  test('snaps the dragged edge', () => {
    const next = resizeBar({
      startMs: start,
      endMs: end,
      edge: 'start',
      deltaMs: 7 * MINUTE,
      stepMs: 15 * MINUTE,
    });
    assert.equal(next.startMs, new Date(2026, 2, 10, 9, 0).getTime());
  });

  test('collapses rather than inverting when the start is dragged past the end', () => {
    const next = resizeBar({
      startMs: start,
      endMs: end,
      edge: 'start',
      deltaMs: 10 * DAY,
      stepMs: HOUR,
    });
    assert.equal(next.startMs, end);
    assert.equal(next.endMs, end);
  });

  test('collapses rather than inverting when the end is dragged past the start', () => {
    const next = resizeBar({
      startMs: start,
      endMs: end,
      edge: 'end',
      deltaMs: -10 * DAY,
      stepMs: HOUR,
    });
    assert.equal(next.startMs, start);
    assert.equal(next.endMs, start);
  });

  test('grows a one-sided task into a range instead of losing it', () => {
    const next = resizeBar({ startMs: null, endMs: end, edge: 'start', deltaMs: -DAY, stepMs: HOUR });
    assert.equal(next.endMs, end);
    assert.equal(next.startMs, end - DAY);
  });

  test('normalises a task stored back to front', () => {
    const next = resizeBar({ startMs: end, endMs: start, edge: 'end', deltaMs: 0, stepMs: HOUR });
    assert.equal(next.startMs, start);
    assert.equal(next.endMs, end);
  });

  test('refuses a task with no dates at all', () => {
    assert.throws(() => resizeBar({
      startMs: null,
      endMs: null,
      edge: 'start',
      deltaMs: 0,
      stepMs: HOUR,
    }));
  });
});

describe('msPerPixel', () => {
  test('divides the span by the width', () => {
    assert.equal(msPerPixel(DAY, 480), DAY / 480);
  });

  test('reports nothing for a chart that has not been measured', () => {
    assert.equal(msPerPixel(DAY, 0), 0);
    assert.equal(msPerPixel(DAY, -10), 0);
  });
});

describe('nudgeStep', () => {
  test('is one step by default', () => {
    assert.equal(nudgeStep(15 * MINUTE, false), 15 * MINUTE);
  });

  test('jumps further with the modifier', () => {
    assert.equal(nudgeStep(15 * MINUTE, true), 4 * HOUR);
    assert.equal(nudgeStep(DAY, true), 7 * DAY);
  });
});
