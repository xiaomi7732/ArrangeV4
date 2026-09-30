import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { TodoItem } from '../store/types';
import { summarizeHiddenByStatus } from './hiddenSummary';
import {
  createDefaultTaskQuery,
  SHOW_ALL_STATUS_FILTERS,
  type TaskQuery,
} from './taskQuery';

function task(overrides: Partial<TodoItem> = {}): TodoItem {
  return { subject: 'Untitled', status: 'new', ...overrides };
}

function query(overrides: Partial<TaskQuery> = {}): TaskQuery {
  return { ...createDefaultTaskQuery(), ...overrides };
}

function isoAt(daysFromNow: number, hour = 9): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

describe('summarizeHiddenByStatus', () => {
  it('reports nothing when every status is shown', () => {
    const summary = summarizeHiddenByStatus(
      [task({ status: 'cancelled' })],
      query({ statusFilters: { ...SHOW_ALL_STATUS_FILTERS } }),
    );
    assert.equal(summary.count, 0);
    assert.equal(summary.label, null);
    assert.deepEqual(summary.statuses, []);
  });

  it('counts items removed by a hide filter', () => {
    const summary = summarizeHiddenByStatus(
      [task(), task({ status: 'cancelled' })],
      query(),
    );
    assert.equal(summary.count, 1);
    assert.deepEqual(summary.statuses, ['cancelled']);
    assert.equal(summary.label, '1 cancelled item hidden');
  });

  it('counts items removed by a today-only filter', () => {
    const summary = summarizeHiddenByStatus(
      [
        task({ status: 'finished', finishDateTime: isoAt(0) }),
        task({ status: 'finished', finishDateTime: isoAt(-4) }),
      ],
      query(),
    );
    assert.equal(summary.count, 1);
    assert.deepEqual(summary.statuses, ['finished']);
    assert.equal(summary.label, '1 finished item hidden');
  });

  it('lists every responsible status and pluralizes', () => {
    const summary = summarizeHiddenByStatus(
      [
        task({ status: 'finished', finishDateTime: isoAt(-2) }),
        task({ status: 'cancelled' }),
        task({ status: 'cancelled' }),
      ],
      query(),
    );
    assert.equal(summary.count, 3);
    assert.deepEqual(summary.statuses, ['finished', 'cancelled']);
    assert.equal(summary.label, '3 finished or cancelled items hidden');
  });

  it('ignores items the search text already excluded', () => {
    const summary = summarizeHiddenByStatus(
      [task({ subject: 'alpha', status: 'cancelled' })],
      query({ text: 'beta' }),
    );
    assert.equal(summary.count, 0);
    assert.equal(summary.label, null);
  });

  it('ignores items excluded by a priority filter', () => {
    const summary = summarizeHiddenByStatus(
      [task({ status: 'cancelled', urgent: false })],
      query({ urgentOnly: true }),
    );
    assert.equal(summary.count, 0);
  });

  it('respects an injected clock for today-only filters', () => {
    const now = new Date('2026-03-10T12:00:00');
    const summary = summarizeHiddenByStatus(
      [task({ status: 'finished', finishDateTime: new Date('2026-03-10T08:00:00').toISOString() })],
      query(),
      now,
    );
    assert.equal(summary.count, 0);
  });
});
