import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { validateBookName } from './bookName';

describe('validateBookName', () => {
  it('rejects empty and whitespace-only names', () => {
    assert.deepEqual(validateBookName('', []), { ok: false, error: 'Book name is required' });
    assert.deepEqual(validateBookName('   ', []), { ok: false, error: 'Book name is required' });
  });

  it('rejects a name that is only the arrange suffix', () => {
    assert.deepEqual(validateBookName(' by arrange', []), {
      ok: false,
      error: 'Book name is required',
    });
  });

  it('trims surrounding whitespace from an accepted name', () => {
    assert.deepEqual(validateBookName('  Launch Plan  ', []), { ok: true, name: 'Launch Plan' });
  });

  it('strips a user-typed arrange suffix so it is not doubled', () => {
    assert.deepEqual(validateBookName('Launch Plan by arrange', []), {
      ok: true,
      name: 'Launch Plan',
    });
  });

  it('rejects an exact duplicate', () => {
    const result = validateBookName('Launch Plan', ['Launch Plan']);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.error, 'A book named "Launch Plan" already exists');
  });

  it('rejects a duplicate that differs only by case or padding', () => {
    assert.equal(validateBookName('  launch PLAN ', ['Launch Plan']).ok, false);
  });

  it('rejects a duplicate that differs only by internal whitespace runs', () => {
    assert.equal(validateBookName('Launch  Plan', ['Launch Plan']).ok, false);
  });

  it('rejects a duplicate when only one side carries the arrange suffix', () => {
    assert.equal(validateBookName('Launch Plan by arrange', ['Launch Plan']).ok, false);
    assert.equal(validateBookName('Launch Plan', ['Launch Plan by arrange']).ok, false);
  });

  it('accepts a distinct name alongside existing books', () => {
    assert.deepEqual(validateBookName('Roadmap', ['Launch Plan', 'Chores']), {
      ok: true,
      name: 'Roadmap',
    });
  });

  it('reports the existing book name as stored', () => {
    const result = validateBookName('chores', ['  Chores  ']);
    assert.equal(result.ok === false && result.error, 'A book named "Chores" already exists');
  });
});
