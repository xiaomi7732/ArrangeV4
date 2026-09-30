import { strict as assert } from 'node:assert';
import { beforeEach, describe, it } from 'node:test';
import { makeBookId } from '../store/types';
import { createDefaultTaskQuery, type TaskQuery } from './taskQuery';
import {
  deletePreset,
  listPresets,
  MAX_PRESET_NAME_LENGTH,
  MAX_PRESETS_PER_BOOK,
  normalizePresetName,
  presetStorageKey,
  renameCategoryInPresets,
  renamePreset,
  sanitizeTaskQuery,
  savePreset,
} from './filterPresets';

class MemoryStorage {
  private entries = new Map<string, string>();
  /** When set, writes throw to emulate a full or blocked quota. */
  failWrites = false;

  getItem(key: string): string | null {
    return this.entries.has(key) ? this.entries.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.entries.set(key, value);
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

const storage = new MemoryStorage();
const globals = globalThis as unknown as Record<string, unknown>;
globals.localStorage = storage;
globals.window = { localStorage: storage };

const calendarBook = makeBookId('calendar', 'book-1');
const sheetsBook = makeBookId('google', 'book-1');

function query(overrides: Partial<TaskQuery> = {}): TaskQuery {
  return { ...createDefaultTaskQuery(), ...overrides };
}

beforeEach(() => {
  storage.clear();
  storage.failWrites = false;
});

describe('presetStorageKey', () => {
  it('separates backends that share a native ID', () => {
    assert.notEqual(presetStorageKey(calendarBook), presetStorageKey(sheetsBook));
  });

  it('treats an unprefixed ID as a legacy calendar book', () => {
    assert.equal(presetStorageKey('book-1'), presetStorageKey(calendarBook));
  });

  it('rejects an unknown prefix', () => {
    assert.equal(presetStorageKey('nope:book-1'), null);
    assert.equal(presetStorageKey(''), null);
  });
});

describe('normalizePresetName', () => {
  it('trims, collapses whitespace and truncates', () => {
    assert.equal(normalizePresetName('  Today   only  '), 'Today only');
    assert.equal(normalizePresetName('a'.repeat(200)).length, MAX_PRESET_NAME_LENGTH);
  });
});

describe('sanitizeTaskQuery', () => {
  it('falls back to defaults for malformed input', () => {
    assert.deepEqual(sanitizeTaskQuery(null), createDefaultTaskQuery());
    assert.deepEqual(sanitizeTaskQuery('nope'), createDefaultTaskQuery());
  });

  it('drops unknown status modes and non-string tags', () => {
    const sanitized = sanitizeTaskQuery({
      text: 'hi',
      statusFilters: { new: 'bogus', blocked: 'hide' },
      categories: ['a', 7, '', 'a'],
      includeUncategorized: 'yes',
      urgentOnly: true,
    });

    assert.equal(sanitized.text, 'hi');
    assert.equal(sanitized.statusFilters.new, 'showAll');
    assert.equal(sanitized.statusFilters.blocked, 'hide');
    assert.deepEqual(sanitized.categories, ['a']);
    assert.equal(sanitized.includeUncategorized, false);
    assert.equal(sanitized.urgentOnly, true);
  });
});

describe('listPresets', () => {
  it('returns nothing for a missing book or corrupt payload', () => {
    assert.deepEqual(listPresets(null), []);
    storage.setItem(presetStorageKey(calendarBook)!, 'not json');
    assert.deepEqual(listPresets(calendarBook), []);
    storage.setItem(presetStorageKey(calendarBook)!, '{"not":"an array"}');
    assert.deepEqual(listPresets(calendarBook), []);
  });

  it('skips entries without a usable id or name, and duplicate ids', () => {
    storage.setItem(presetStorageKey(calendarBook)!, JSON.stringify([
      { id: '', name: 'no id' },
      { id: 'a', name: '   ' },
      { id: 'b', name: 'Good' },
      { id: 'b', name: 'Duplicate' },
    ]));

    const presets = listPresets(calendarBook);
    assert.equal(presets.length, 1);
    assert.equal(presets[0].name, 'Good');
  });
});

describe('savePreset', () => {
  it('persists a preset and keeps books isolated', () => {
    savePreset(calendarBook, 'Urgent', query({ urgentOnly: true }));

    const saved = listPresets(calendarBook);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].name, 'Urgent');
    assert.equal(saved[0].query.urgentOnly, true);
    assert.deepEqual(listPresets(sheetsBook), []);
  });

  it('overwrites a preset with the same name regardless of case', () => {
    const first = savePreset(calendarBook, 'Urgent', query({ urgentOnly: true }));
    const second = savePreset(calendarBook, '  urgent ', query({ importantOnly: true }));

    assert.equal(second.presets.length, 1);
    assert.equal(second.presets[0].id, first.preset!.id);
    assert.equal(second.presets[0].name, 'urgent');
    assert.equal(second.presets[0].query.urgentOnly, false);
    assert.equal(second.presets[0].query.importantOnly, true);
  });

  it('rejects a blank name', () => {
    const result = savePreset(calendarBook, '   ', query());
    assert.ok(result.error);
    assert.deepEqual(listPresets(calendarBook), []);
  });

  it('enforces the per-book limit for new names only', () => {
    for (let i = 0; i < MAX_PRESETS_PER_BOOK; i++) {
      savePreset(calendarBook, `Preset ${i}`, query({ text: `${i}` }));
    }
    assert.equal(listPresets(calendarBook).length, MAX_PRESETS_PER_BOOK);

    const overflow = savePreset(calendarBook, 'One more', query());
    assert.ok(overflow.error);
    assert.equal(listPresets(calendarBook).length, MAX_PRESETS_PER_BOOK);

    const overwrite = savePreset(calendarBook, 'Preset 0', query({ text: 'updated' }));
    assert.equal(overwrite.error, undefined);
    assert.equal(overwrite.presets[0].query.text, 'updated');
  });

  it('reports an error and leaves state unchanged when storage rejects writes', () => {
    storage.failWrites = true;
    const result = savePreset(calendarBook, 'Urgent', query({ urgentOnly: true }));
    assert.ok(result.error);
    assert.deepEqual(result.presets, []);
  });
});

describe('renamePreset', () => {
  it('renames an existing preset', () => {
    const saved = savePreset(calendarBook, 'Urgent', query({ urgentOnly: true }));
    const result = renamePreset(calendarBook, saved.preset!.id, 'Hot list');

    assert.equal(result.error, undefined);
    assert.equal(listPresets(calendarBook)[0].name, 'Hot list');
  });

  it('rejects a duplicate name, a blank name, and an unknown id', () => {
    const first = savePreset(calendarBook, 'Urgent', query({ urgentOnly: true }));
    savePreset(calendarBook, 'Important', query({ importantOnly: true }));

    assert.ok(renamePreset(calendarBook, first.preset!.id, 'important').error);
    assert.ok(renamePreset(calendarBook, first.preset!.id, ' ').error);
    assert.ok(renamePreset(calendarBook, 'missing-id', 'Anything').error);
    assert.equal(listPresets(calendarBook)[0].name, 'Urgent');
  });

  it('allows renaming a preset to its own name', () => {
    const saved = savePreset(calendarBook, 'Urgent', query({ urgentOnly: true }));
    assert.equal(renamePreset(calendarBook, saved.preset!.id, 'Urgent').error, undefined);
  });
});

describe('deletePreset', () => {
  it('removes a preset and is a no-op for unknown ids', () => {
    const saved = savePreset(calendarBook, 'Urgent', query({ urgentOnly: true }));

    assert.deepEqual(deletePreset(calendarBook, 'missing-id').presets.length, 1);
    assert.deepEqual(deletePreset(calendarBook, saved.preset!.id).presets, []);
    assert.deepEqual(listPresets(calendarBook), []);
  });
});

describe('renameCategoryInPresets', () => {
  it('rewrites a renamed tag across presets', () => {
    savePreset(calendarBook, 'Infra', query({ categories: ['infra', 'ops'] }));
    savePreset(calendarBook, 'Writing', query({ categories: ['writing'] }));

    const updated = renameCategoryInPresets(calendarBook, 'infra', 'platform');

    assert.deepEqual(updated[0].query.categories, ['ops', 'platform']);
    assert.deepEqual(updated[1].query.categories, ['writing']);
    assert.deepEqual(listPresets(calendarBook)[0].query.categories, ['ops', 'platform']);
  });

  it('drops a deleted tag', () => {
    savePreset(calendarBook, 'Infra', query({ categories: ['infra', 'ops'] }));
    const updated = renameCategoryInPresets(calendarBook, 'infra', null);
    assert.deepEqual(updated[0].query.categories, ['ops']);
  });

  it('does not duplicate the target when merging into an existing tag', () => {
    savePreset(calendarBook, 'Infra', query({ categories: ['infra', 'ops'] }));
    const updated = renameCategoryInPresets(calendarBook, 'infra', 'ops');
    assert.deepEqual(updated[0].query.categories, ['ops']);
  });

  it('leaves presets untouched when the tag is unused', () => {
    savePreset(calendarBook, 'Writing', query({ categories: ['writing'] }));
    const updated = renameCategoryInPresets(calendarBook, 'infra', 'platform');
    assert.deepEqual(updated[0].query.categories, ['writing']);
  });
});
