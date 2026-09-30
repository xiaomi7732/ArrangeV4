import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { statusTimestampUpdates } from './statusTimestamps';

const NOW = '2026-09-30T18:23:00.000Z';

describe('statusTimestampUpdates', () => {
  it('records a start time on the first move to in progress', () => {
    assert.deepEqual(
      statusTimestampUpdates({ status: 'new' }, 'inProgress', NOW),
      { startDateTime: NOW },
    );
  });

  it('keeps the original start time when work resumes', () => {
    assert.deepEqual(
      statusTimestampUpdates(
        { status: 'blocked', startDateTime: '2026-09-10T10:00:00.000Z' },
        'inProgress',
        NOW,
      ),
      {},
    );
  });

  it('clears the start time with an explicit null when sent back to new', () => {
    const updates = statusTimestampUpdates(
      { status: 'inProgress', startDateTime: '2026-09-10T10:00:00.000Z' },
      'new',
      NOW,
    );

    assert.deepEqual(updates, { startDateTime: null });
    // undefined would be read as "no change" and leave the stale value stored.
    assert.equal(Object.prototype.hasOwnProperty.call(updates, 'startDateTime'), true);
    assert.notEqual(updates.startDateTime, undefined);
  });

  it('does not clear a start time that was never set', () => {
    assert.deepEqual(statusTimestampUpdates({ status: 'blocked' }, 'new', NOW), {});
  });

  it('backfills both timestamps when a task is finished outright', () => {
    assert.deepEqual(
      statusTimestampUpdates({ status: 'new' }, 'finished', NOW),
      { startDateTime: NOW, finishDateTime: NOW },
    );
  });

  it('keeps a real start time when finishing', () => {
    assert.deepEqual(
      statusTimestampUpdates(
        { status: 'inProgress', startDateTime: '2026-09-10T10:00:00.000Z' },
        'finished',
        NOW,
      ),
      { finishDateTime: NOW },
    );
  });

  it('clears the finish time when a finished task is reopened', () => {
    assert.deepEqual(
      statusTimestampUpdates(
        {
          status: 'finished',
          startDateTime: '2026-09-10T10:00:00.000Z',
          finishDateTime: '2026-09-20T10:00:00.000Z',
        },
        'inProgress',
        NOW,
      ),
      { finishDateTime: null },
    );
  });

  it('clears both timestamps when a finished task goes back to new', () => {
    assert.deepEqual(
      statusTimestampUpdates(
        {
          status: 'finished',
          startDateTime: '2026-09-10T10:00:00.000Z',
          finishDateTime: '2026-09-20T10:00:00.000Z',
        },
        'new',
        NOW,
      ),
      { startDateTime: null, finishDateTime: null },
    );
  });

  it('leaves timestamps alone when only blocking a task', () => {
    assert.deepEqual(
      statusTimestampUpdates(
        { status: 'inProgress', startDateTime: '2026-09-10T10:00:00.000Z' },
        'blocked',
        NOW,
      ),
      {},
    );
  });
});
