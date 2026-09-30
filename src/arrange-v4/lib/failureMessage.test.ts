import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { describeFailure } from './failureMessage';

describe('describeFailure', () => {
  it('names the action before the technical reason', () => {
    assert.equal(
      describeFailure('Could not save your changes.', new Error('Failed to fetch')),
      'Could not save your changes. Failed to fetch',
    );
  });

  it('keeps the action alone when there is no usable detail', () => {
    assert.equal(describeFailure('Could not save your changes.', {}), 'Could not save your changes.');
    assert.equal(
      describeFailure('Could not save your changes.', new Error('   ')),
      'Could not save your changes.',
    );
  });

  it('does not repeat a detail the action already states', () => {
    assert.equal(
      describeFailure('Could not load the board.', new Error('Could not load the board.')),
      'Could not load the board.',
    );
  });
});
