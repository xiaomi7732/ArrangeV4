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
  /** When set, reads throw to emulate storage blocked by browser settings. */
  failReads = false;

  /** When set, writes to matching keys throw while others succeed. */
  failWritesMatching: RegExp | null = null;

  getItem(key: string): string | null {
    if (this.failReads) throw new Error('SecurityError');
    return this.entries.has(key) ? this.entries.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites || this.failWritesMatching?.test(key)) {
      throw new Error('QuotaExceededError');
    }
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
  storage.failWritesMatching = null;
  storage.failReads = false;
});

describe('presetStorageKey', () => {
  it('separates backends that share a native ID', () => {
    assert.notEqual(presetStorageKey(calendarBook, 'board'), presetStorageKey(sheetsBook, 'board'));
  });

  it('treats an unprefixed ID as a legacy calendar book', () => {
    assert.equal(presetStorageKey('book-1', 'board'), presetStorageKey(calendarBook, 'board'));
  });

  it('rejects an unknown prefix', () => {
    assert.equal(presetStorageKey('nope:book-1', 'board'), null);
    assert.equal(presetStorageKey('', 'board'), null);
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

  it('drops priority criteria for a scope that cannot show them', () => {
    const sanitized = sanitizeTaskQuery(
      { text: 'hi', categories: ['a'], includeUncategorized: true, urgentOnly: true, importantOnly: true },
      'matrix',
    );

    assert.equal(sanitized.text, 'hi');
    // Matrix still filters by tag; the quadrants already express priority.
    assert.deepEqual(sanitized.categories, ['a']);
    assert.equal(sanitized.includeUncategorized, true);
    assert.equal(sanitized.urgentOnly, false);
    assert.equal(sanitized.importantOnly, false);
  });

  it('drops tag and priority criteria for search-only scopes', () => {
    for (const scope of ['cancelled', 'timeline'] as const) {
      const sanitized = sanitizeTaskQuery(
        { categories: ['a'], includeUncategorized: true, urgentOnly: true, importantOnly: true },
        scope,
      );
      assert.deepEqual(sanitized.categories, []);
      assert.equal(sanitized.includeUncategorized, false);
      assert.equal(sanitized.urgentOnly, false);
      assert.equal(sanitized.importantOnly, false);
    }
  });
});

describe('matrix preset inheritance', () => {
  it('inherits the board presets once, without their priority criteria', () => {
    savePreset(calendarBook, 'board', 'Hot', query({ text: 'bug', categories: ['a'], urgentOnly: true }));

    const inherited = listPresets(calendarBook, 'matrix');
    assert.equal(inherited.length, 1);
    assert.equal(inherited[0].name, 'Hot');
    assert.equal(inherited[0].query.text, 'bug');
    assert.deepEqual(inherited[0].query.categories, ['a']);
    assert.equal(inherited[0].query.urgentOnly, false);

    // The board pool keeps its own copy untouched.
    assert.equal(listPresets(calendarBook, 'board')[0].query.urgentOnly, true);
  });

  it('does not resurrect inherited presets after they are deleted', () => {
    savePreset(calendarBook, 'board', 'Hot', query({ text: 'bug' }));
    const inherited = listPresets(calendarBook, 'matrix');
    deletePreset(calendarBook, 'matrix', inherited[0].id);

    assert.deepEqual(listPresets(calendarBook, 'matrix'), []);
  });

  it('retries inheritance when the copy could not be written', () => {
    savePreset(calendarBook, 'board', 'Hot', query({ text: 'bug' }));
    storage.failWrites = true;

    assert.equal(listPresets(calendarBook, 'matrix').length, 1);

    storage.failWrites = false;
    // The failed copy was not marked done, so the presets are still there.
    assert.equal(listPresets(calendarBook, 'matrix').length, 1);
    assert.equal(listPresets(calendarBook, 'matrix')[0].name, 'Hot');
  });

  it('reports failure rather than losing the marker on the last delete', () => {
    savePreset(calendarBook, 'board', 'Hot', query({ text: 'bug' }));
    const inherited = listPresets(calendarBook, 'matrix');
    // Emulate the marker being dropped while the list itself is writable, so
    // emptying the list could not be told apart from a first visit.
    storage.removeItem(`${presetStorageKey(calendarBook, 'matrix')}_migrated`);
    storage.failWritesMatching = /_migrated$/;

    const result = deletePreset(calendarBook, 'matrix', inherited[0].id);
    assert.ok(result.error);
    assert.equal(listPresets(calendarBook, 'matrix').length, 1);
  });

  it('keeps a preset saved on Matrix alongside the inherited ones', () => {
    savePreset(calendarBook, 'board', 'Hot', query({ text: 'bug', urgentOnly: true }));
    savePreset(calendarBook, 'matrix', 'Mine', query({ text: 'mine' }));

    const names = listPresets(calendarBook, 'matrix').map(preset => preset.name);
    assert.deepEqual(new Set(names), new Set(['Hot', 'Mine']));
  });
});

describe('listPresets', () => {
  it('returns nothing for a missing book or corrupt payload', () => {
    assert.deepEqual(listPresets(null, 'board'), []);
    storage.setItem(presetStorageKey(calendarBook, 'board')!, 'not json');
    assert.deepEqual(listPresets(calendarBook, 'board'), []);
    storage.setItem(presetStorageKey(calendarBook, 'board')!, '{"not":"an array"}');
    assert.deepEqual(listPresets(calendarBook, 'board'), []);
  });

  it('skips entries without a usable id or name, and duplicate ids', () => {
    storage.setItem(presetStorageKey(calendarBook, 'board')!, JSON.stringify([
      { id: '', name: 'no id' },
      { id: 'a', name: '   ' },
      { id: 'b', name: 'Good' },
      { id: 'b', name: 'Duplicate' },
    ]));

    const presets = listPresets(calendarBook, 'board');
    assert.equal(presets.length, 1);
    assert.equal(presets[0].name, 'Good');
  });
});

describe('savePreset', () => {
  it('persists a preset and keeps books isolated', () => {
    savePreset(calendarBook, 'board', 'Urgent', query({ urgentOnly: true }));

    const saved = listPresets(calendarBook, 'board');
    assert.equal(saved.length, 1);
    assert.equal(saved[0].name, 'Urgent');
    assert.equal(saved[0].query.urgentOnly, true);
    assert.deepEqual(listPresets(sheetsBook, 'board'), []);
  });

  it('updates the selected preset in place, regardless of name case', () => {
    const first = savePreset(calendarBook, 'board', 'Urgent', query({ urgentOnly: true }));
    const second = savePreset(
      calendarBook,
      'board',
      '  urgent ',
      query({ importantOnly: true }),
      first.preset!.id,
    );

    assert.equal(second.presets.length, 1);
    assert.equal(second.presets[0].id, first.preset!.id);
    assert.equal(second.presets[0].name, 'urgent');
    assert.equal(second.presets[0].query.urgentOnly, false);
    assert.equal(second.presets[0].query.importantOnly, true);
  });

  it('refuses to overwrite a different preset that already uses the name', () => {
    savePreset(calendarBook, 'board', 'Urgent', query({ urgentOnly: true }));
    const other = savePreset(calendarBook, 'board', 'Important', query({ importantOnly: true }));

    const result = savePreset(
      calendarBook,
      'board',
      'urgent',
      query({ text: 'clobber' }),
      other.preset!.id,
    );

    assert.ok(result.error);
    assert.equal(listPresets(calendarBook, 'board')[0].query.urgentOnly, true);
    assert.equal(listPresets(calendarBook, 'board').length, 2);
  });

  it('rejects a blank name', () => {
    const result = savePreset(calendarBook, 'board', '   ', query());
    assert.ok(result.error);
    assert.deepEqual(listPresets(calendarBook, 'board'), []);
  });

  it('enforces the per-book limit for new names only', () => {
    for (let i = 0; i < MAX_PRESETS_PER_BOOK; i++) {
      savePreset(calendarBook, 'board', `Preset ${i}`, query({ text: `${i}` }));
    }
    assert.equal(listPresets(calendarBook, 'board').length, MAX_PRESETS_PER_BOOK);

    const overflow = savePreset(calendarBook, 'board', 'One more', query());
    assert.ok(overflow.error);
    assert.equal(listPresets(calendarBook, 'board').length, MAX_PRESETS_PER_BOOK);

    const existingId = listPresets(calendarBook, 'board')[0].id;
    const overwrite = savePreset(calendarBook, 'board', 'Preset 0', query({ text: 'updated' }), existingId);
    assert.equal(overwrite.error, undefined);
    assert.equal(overwrite.presets[0].query.text, 'updated');
  });

  it('reports an error and leaves state unchanged when storage rejects writes', () => {
    storage.failWrites = true;
    const result = savePreset(calendarBook, 'board', 'Urgent', query({ urgentOnly: true }));
    assert.ok(result.error);
    assert.deepEqual(result.presets, []);
  });
});

describe('renamePreset', () => {
  it('renames an existing preset', () => {
    const saved = savePreset(calendarBook, 'board', 'Urgent', query({ urgentOnly: true }));
    const result = renamePreset(calendarBook, 'board', saved.preset!.id, 'Hot list');

    assert.equal(result.error, undefined);
    assert.equal(listPresets(calendarBook, 'board')[0].name, 'Hot list');
  });

  it('rejects a duplicate name, a blank name, and an unknown id', () => {
    const first = savePreset(calendarBook, 'board', 'Urgent', query({ urgentOnly: true }));
    savePreset(calendarBook, 'board', 'Important', query({ importantOnly: true }));

    assert.ok(renamePreset(calendarBook, 'board', first.preset!.id, 'important').error);
    assert.ok(renamePreset(calendarBook, 'board', first.preset!.id, ' ').error);
    assert.ok(renamePreset(calendarBook, 'board', 'missing-id', 'Anything').error);
    assert.equal(listPresets(calendarBook, 'board')[0].name, 'Urgent');
  });

  it('allows renaming a preset to its own name', () => {
    const saved = savePreset(calendarBook, 'board', 'Urgent', query({ urgentOnly: true }));
    assert.equal(renamePreset(calendarBook, 'board', saved.preset!.id, 'Urgent').error, undefined);
  });
});

describe('deletePreset', () => {
  it('removes a preset and is a no-op for unknown ids', () => {
    const saved = savePreset(calendarBook, 'board', 'Urgent', query({ urgentOnly: true }));

    assert.deepEqual(deletePreset(calendarBook, 'board', 'missing-id').presets.length, 1);
    assert.deepEqual(deletePreset(calendarBook, 'board', saved.preset!.id).presets, []);
    assert.deepEqual(listPresets(calendarBook, 'board'), []);
  });
});

describe('renameCategoryInPresets', () => {
  it('rewrites a renamed tag across presets', () => {
    savePreset(calendarBook, 'board', 'Infra', query({ categories: ['infra', 'ops'] }));
    savePreset(calendarBook, 'board', 'Writing', query({ categories: ['writing'] }));

    const { presets: updated } = renameCategoryInPresets(calendarBook, 'board', 'infra', 'platform');

    assert.deepEqual(updated[0].query.categories, ['ops', 'platform']);
    assert.deepEqual(updated[1].query.categories, ['writing']);
    assert.deepEqual(listPresets(calendarBook, 'board')[0].query.categories, ['ops', 'platform']);
  });

  it('drops a deleted tag', () => {
    savePreset(calendarBook, 'board', 'Infra', query({ categories: ['infra', 'ops'] }));
    const { presets: updated } = renameCategoryInPresets(calendarBook, 'board', 'infra', null);
    assert.deepEqual(updated[0].query.categories, ['ops']);
  });

  it('does not duplicate the target when merging into an existing tag', () => {
    savePreset(calendarBook, 'board', 'Infra', query({ categories: ['infra', 'ops'] }));
    const { presets: updated } = renameCategoryInPresets(calendarBook, 'board', 'infra', 'ops');
    assert.deepEqual(updated[0].query.categories, ['ops']);
  });

  it('leaves presets untouched when the tag is unused', () => {
    savePreset(calendarBook, 'board', 'Writing', query({ categories: ['writing'] }));
    const { presets: updated } = renameCategoryInPresets(calendarBook, 'board', 'infra', 'platform');
    assert.deepEqual(updated[0].query.categories, ['writing']);
  });

  it('rewrites the tag in every scope that can hold tags', () => {
    savePreset(calendarBook, 'board', 'Infra', query({ categories: ['infra'] }));
    // Materialise the Matrix pool from the board one before the rename.
    assert.deepEqual(listPresets(calendarBook, 'matrix')[0].query.categories, ['infra']);

    renameCategoryInPresets(calendarBook, 'matrix', 'infra', 'platform');

    assert.deepEqual(listPresets(calendarBook, 'matrix')[0].query.categories, ['platform']);
    assert.deepEqual(listPresets(calendarBook, 'board')[0].query.categories, ['platform']);
  });

  it('reports an error when the rewrite cannot be persisted', () => {
    savePreset(calendarBook, 'board', 'Infra', query({ categories: ['infra'] }));
    storage.failWrites = true;

    const result = renameCategoryInPresets(calendarBook, 'board', 'infra', 'platform');

    assert.ok(result.error);
    assert.deepEqual(result.presets[0].query.categories, ['infra']);
  });
});

describe('preset scopes', () => {
  it('keeps each scope in its own storage key', () => {
    assert.notEqual(
      presetStorageKey(calendarBook, 'board'),
      presetStorageKey(calendarBook, 'cancelled'),
    );
  });

  it('never exposes a preset saved in another scope', () => {
    savePreset(calendarBook, 'board', 'Urgent', query({ urgentOnly: true }));

    assert.deepEqual(listPresets(calendarBook, 'cancelled'), []);
    assert.equal(listPresets(calendarBook, 'board').length, 1);
  });

  it('lets the same name exist independently in both scopes', () => {
    const board = savePreset(calendarBook, 'board', 'Deploy', query({ urgentOnly: true }));
    const cancelled = savePreset(calendarBook, 'cancelled', 'Deploy', query({ text: 'deploy' }));

    assert.notEqual(board.preset!.id, cancelled.preset!.id);
    assert.equal(listPresets(calendarBook, 'board')[0].query.urgentOnly, true);
    assert.equal(listPresets(calendarBook, 'cancelled')[0].query.urgentOnly, false);
    assert.equal(listPresets(calendarBook, 'cancelled')[0].query.text, 'deploy');
  });

  it('deletes only within the scope it was asked for', () => {
    const board = savePreset(calendarBook, 'board', 'Deploy', query({ urgentOnly: true }));
    savePreset(calendarBook, 'cancelled', 'Deploy', query({ text: 'deploy' }));

    deletePreset(calendarBook, 'board', board.preset!.id);

    assert.deepEqual(listPresets(calendarBook, 'board'), []);
    assert.equal(listPresets(calendarBook, 'cancelled').length, 1);
  });

  it('strips criteria the cancelled view cannot display, on save and on read', () => {
    const saved = savePreset(
      calendarBook,
      'cancelled',
      'Deploy',
      query({ text: 'deploy', categories: ['ops'], includeUncategorized: true, urgentOnly: true }),
    );

    assert.deepEqual(saved.preset!.query.categories, []);
    assert.equal(saved.preset!.query.includeUncategorized, false);
    assert.equal(saved.preset!.query.urgentOnly, false);
    assert.equal(saved.preset!.query.text, 'deploy');
  });

  it('strips hidden criteria from a legacy cancelled preset already in storage', () => {
    storage.setItem(
      presetStorageKey(calendarBook, 'cancelled')!,
      JSON.stringify([
        {
          id: 'legacy',
          name: 'Legacy',
          query: { text: 'deploy', categories: ['ops'], importantOnly: true },
        },
      ]),
    );

    const [preset] = listPresets(calendarBook, 'cancelled');
    assert.deepEqual(preset.query.categories, []);
    assert.equal(preset.query.importantOnly, false);
    assert.equal(preset.query.text, 'deploy');
  });

  it('keeps those criteria for board presets', () => {
    const saved = savePreset(
      calendarBook,
      'board',
      'Deploy',
      query({ categories: ['ops'], urgentOnly: true }),
    );

    assert.deepEqual(saved.preset!.query.categories, ['ops']);
    assert.equal(saved.preset!.query.urgentOnly, true);
  });

  it('gives the timeline view a storage key of its own', () => {
    const keys = [
      presetStorageKey(calendarBook, 'board'),
      presetStorageKey(calendarBook, 'cancelled'),
      presetStorageKey(calendarBook, 'timeline'),
    ];
    assert.equal(new Set(keys).size, 3);
  });

  it('never leaks a preset between the timeline and the other views', () => {
    savePreset(calendarBook, 'board', 'Urgent', query({ urgentOnly: true }));
    savePreset(calendarBook, 'cancelled', 'Dropped', query({ text: 'dropped' }));
    const timeline = savePreset(calendarBook, 'timeline', 'Release', query({ text: 'release' }));

    assert.deepEqual(listPresets(calendarBook, 'timeline').map(p => p.name), ['Release']);
    assert.equal(listPresets(calendarBook, 'board').length, 1);
    assert.equal(listPresets(calendarBook, 'cancelled').length, 1);

    deletePreset(calendarBook, 'timeline', timeline.preset!.id);

    assert.deepEqual(listPresets(calendarBook, 'timeline'), []);
    assert.equal(listPresets(calendarBook, 'board').length, 1);
    assert.equal(listPresets(calendarBook, 'cancelled').length, 1);
  });

  it('strips criteria the timeline cannot display, on save and on read', () => {
    const saved = savePreset(
      calendarBook,
      'timeline',
      'Release',
      query({ text: 'release', categories: ['ops'], includeUncategorized: true, importantOnly: true }),
    );

    assert.deepEqual(saved.preset!.query.categories, []);
    assert.equal(saved.preset!.query.includeUncategorized, false);
    assert.equal(saved.preset!.query.importantOnly, false);
    assert.equal(saved.preset!.query.text, 'release');

    storage.setItem(
      presetStorageKey(calendarBook, 'timeline')!,
      JSON.stringify([
        {
          id: 'legacy',
          name: 'Legacy',
          query: { text: 'release', categories: ['ops'], urgentOnly: true },
        },
      ]),
    );

    const [preset] = listPresets(calendarBook, 'timeline');
    assert.deepEqual(preset.query.categories, []);
    assert.equal(preset.query.urgentOnly, false);
    assert.equal(preset.query.text, 'release');
  });
});

describe('unreadable storage', () => {
  it('reports an error instead of reporting success on delete', () => {
    const saved = savePreset(calendarBook, 'board', 'Urgent', query({ urgentOnly: true }));
    storage.failReads = true;

    const result = deletePreset(calendarBook, 'board', saved.preset!.id);

    assert.ok(result.error);
    storage.failReads = false;
    assert.equal(listPresets(calendarBook, 'board').length, 1);
  });

  it('reports an error instead of silently skipping a tag rename', () => {
    savePreset(calendarBook, 'board', 'Ops', query({ categories: ['ops'] }));
    storage.failReads = true;

    const result = renameCategoryInPresets(calendarBook, 'board', 'ops', 'platform');

    assert.ok(result.error);
    storage.failReads = false;
    assert.deepEqual(listPresets(calendarBook, 'board')[0].query.categories, ['ops']);
  });

  it('refuses to save over a list it could not read', () => {
    savePreset(calendarBook, 'board', 'Urgent', query({ urgentOnly: true }));
    storage.failReads = true;

    const result = savePreset(calendarBook, 'board', 'Another', query({ text: 'x' }));

    assert.ok(result.error);
    storage.failReads = false;
    assert.equal(listPresets(calendarBook, 'board').length, 1);
  });

  it('reports an error on rename', () => {
    const saved = savePreset(calendarBook, 'board', 'Urgent', query({ urgentOnly: true }));
    storage.failReads = true;

    const result = renamePreset(calendarBook, 'board', saved.preset!.id, 'Hot');

    assert.ok(result.error);
    storage.failReads = false;
    assert.equal(listPresets(calendarBook, 'board')[0].name, 'Urgent');
  });

  it('treats corrupt contents as an empty list rather than a failure', () => {
    storage.setItem(presetStorageKey(calendarBook, 'board')!, 'not json');

    const result = savePreset(calendarBook, 'board', 'Urgent', query({ urgentOnly: true }));

    assert.equal(result.error, undefined);
    assert.equal(listPresets(calendarBook, 'board').length, 1);
  });
});
