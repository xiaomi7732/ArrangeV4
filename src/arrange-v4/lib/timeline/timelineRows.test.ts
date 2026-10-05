import test from 'node:test';
import assert from 'node:assert/strict';
import type { TodoItemWithId } from '../store/types';
import { buildTimelineRows, countTimelineRows } from './timelineRows';
import { type TimelineWindow } from './timelineWindow';

const DAY_MS = 24 * 60 * 60 * 1000;
const START = Date.UTC(2024, 4, 1);
const WINDOW: TimelineWindow = { startMs: START, endMs: START + 10 * DAY_MS };

function item(overrides: Partial<TodoItemWithId> & { id: string; subject: string }): TodoItemWithId {
  return {
    status: 'new',
    ...overrides,
  } as TodoItemWithId;
}

test('buildTimelineRows drops tasks with no usable date', () => {
  const rows = buildTimelineRows([
    item({ id: 'a', subject: 'No dates' }),
    item({ id: 'b', subject: 'Bad date', etsDateTime: 'not a date' }),
  ], WINDOW);
  assert.equal(rows.length, 0);
});

test('buildTimelineRows drops tasks entirely outside the window', () => {
  const rows = buildTimelineRows([
    item({
      id: 'a',
      subject: 'Last month',
      etsDateTime: new Date(START - 40 * DAY_MS).toISOString(),
      etaDateTime: new Date(START - 39 * DAY_MS).toISOString(),
    }),
  ], WINDOW);
  assert.equal(rows.length, 0);
});

test('buildTimelineRows marks a task that runs past both edges as clipped', () => {
  const [row] = buildTimelineRows([
    item({
      id: 'a',
      subject: 'Long haul',
      etsDateTime: new Date(START - DAY_MS).toISOString(),
      etaDateTime: new Date(START + 20 * DAY_MS).toISOString(),
    }),
  ], WINDOW);
  assert.ok(row);
  assert.equal(row.left, 0);
  assert.equal(row.width, 100);
  assert.equal(row.clippedStart, true);
  assert.equal(row.clippedEnd, true);
});

test('buildTimelineRows orders bars by start, then by subject', () => {
  const rows = buildTimelineRows([
    item({
      id: 'late',
      subject: 'Later',
      etsDateTime: new Date(START + 5 * DAY_MS).toISOString(),
      etaDateTime: new Date(START + 6 * DAY_MS).toISOString(),
    }),
    item({
      id: 'b',
      subject: 'Beta',
      etsDateTime: new Date(START + DAY_MS).toISOString(),
      etaDateTime: new Date(START + 2 * DAY_MS).toISOString(),
    }),
    item({
      id: 'a',
      subject: 'Alpha',
      etsDateTime: new Date(START + DAY_MS).toISOString(),
      etaDateTime: new Date(START + 2 * DAY_MS).toISOString(),
    }),
  ], WINDOW);
  assert.deepEqual(rows.map(row => row.item.id), ['a', 'b', 'late']);
});

test('buildTimelineRows tooltips name the task, its status and its dates', () => {
  const [row] = buildTimelineRows([
    item({
      id: 'a',
      subject: 'Write report',
      status: 'inProgress',
      etsDateTime: new Date(START + DAY_MS).toISOString(),
      etaDateTime: new Date(START + 2 * DAY_MS).toISOString(),
    }),
  ], WINDOW);
  const lines = row.tooltip.split('\n');
  assert.equal(lines[0], 'Write report');
  assert.equal(lines[1], 'In Progress');
  assert.ok(lines[2].startsWith('ETS: '));
  assert.ok(lines[3].startsWith('ETA: '));
});

test('buildTimelineRows keeps the same order when a bar is clipped by the window', () => {
  const items = [
    item({
      id: 'early',
      subject: 'Zeta starts first',
      etsDateTime: new Date(START - DAY_MS).toISOString(),
      etaDateTime: new Date(START + 4 * DAY_MS).toISOString(),
    }),
    item({
      id: 'later',
      subject: 'Alpha starts later',
      etsDateTime: new Date(START + DAY_MS).toISOString(),
      etaDateTime: new Date(START + 2 * DAY_MS).toISOString(),
    }),
  ];
  const wide = buildTimelineRows(items, { startMs: START - 2 * DAY_MS, endMs: START + 10 * DAY_MS });
  // The first bar now runs off the left edge, but it still began earlier.
  const clipped = buildTimelineRows(items, WINDOW);
  assert.deepEqual(wide.map(row => row.item.id), ['early', 'later']);
  assert.deepEqual(clipped.map(row => row.item.id), ['early', 'later']);
});

test('countTimelineRows counts only what would be drawn', () => {
  const items = [
    item({ id: 'none', subject: 'No dates' }),
    item({ id: 'outside', subject: 'Outside', etsDateTime: new Date(START + 90 * DAY_MS).toISOString() }),
    item({ id: 'inside', subject: 'Inside', etsDateTime: new Date(START + DAY_MS).toISOString() }),
  ];
  assert.equal(countTimelineRows(items, WINDOW), 1);
  assert.equal(items.length, 3);
});
