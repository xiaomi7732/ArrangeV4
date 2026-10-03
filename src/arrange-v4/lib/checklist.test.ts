import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  checklistEntryText,
  countCheckedEntries,
  formatChecklistEntry,
  parseChecklistEntry,
  toggleChecklistEntry,
} from './checklist';

describe('parseChecklistEntry', () => {
  it('reads an unchecked entry', () => {
    assert.deepEqual(parseChecklistEntry('-[] buy milk'), { checked: false, text: 'buy milk' });
  });

  it('reads a checked entry', () => {
    assert.deepEqual(parseChecklistEntry('-[x] buy milk'), { checked: true, text: 'buy milk' });
  });

  it('accepts the upper-case marker older items may carry', () => {
    assert.deepEqual(parseChecklistEntry('-[X] buy milk'), { checked: true, text: 'buy milk' });
  });

  it('keeps an entry that has no marker at all', () => {
    assert.deepEqual(parseChecklistEntry('buy milk'), { checked: false, text: 'buy milk' });
  });

  it('keeps Markdown in the text, including a marker-like link', () => {
    assert.deepEqual(
      parseChecklistEntry('-[] see [docs](https://x/y) **now**'),
      { checked: false, text: 'see [docs](https://x/y) **now**' },
    );
  });

  it('only strips the leading marker, not one later in the line', () => {
    assert.equal(checklistEntryText('-[] a -[x] b'), 'a -[x] b');
  });

  it('tolerates a missing space after the marker', () => {
    assert.deepEqual(parseChecklistEntry('-[x]done'), { checked: true, text: 'done' });
  });
});

describe('formatChecklistEntry', () => {
  it('round-trips through the parser', () => {
    const entry = formatChecklistEntry(true, '**bold** item');
    assert.equal(entry, '-[x] **bold** item');
    assert.deepEqual(parseChecklistEntry(entry), { checked: true, text: '**bold** item' });
  });
});

describe('toggleChecklistEntry', () => {
  it('ticks and unticks without disturbing the text', () => {
    assert.equal(toggleChecklistEntry('-[] a *b*'), '-[x] a *b*');
    assert.equal(toggleChecklistEntry('-[x] a *b*'), '-[] a *b*');
  });

  it('ticks an entry stored without a marker', () => {
    assert.equal(toggleChecklistEntry('plain'), '-[x] plain');
  });
});

describe('countCheckedEntries', () => {
  it('counts only the ticked entries', () => {
    assert.equal(countCheckedEntries(['-[x] a', '-[] b', '-[X] c', 'd']), 2);
  });

  it('counts nothing in an empty checklist', () => {
    assert.equal(countCheckedEntries([]), 0);
  });
});
