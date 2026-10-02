import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { TodoItem } from '../store/types';
import {
  createDefaultTaskQuery,
  DEFAULT_STATUS_FILTERS,
  filterTasks,
  isQueryActive,
  isStatusFilterActive,
  checklistText,
  matchesSearchTerms,
  searchTerms,
  SHOW_ALL_STATUS_FILTERS,
  taskQueriesEqual,
  taskSearchText,
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

describe('searchTerms', () => {
  it('splits on whitespace and lowercases', () => {
    assert.deepEqual(searchTerms('  Fix   API Bug '), ['fix', 'api', 'bug']);
  });

  it('returns no terms for blank input', () => {
    assert.deepEqual(searchTerms('   '), []);
  });
});

describe('checklistText', () => {
  it('strips checked and unchecked markers', () => {
    assert.equal(checklistText('-[x] call vendor'), 'call vendor');
    assert.equal(checklistText('-[X] call vendor'), 'call vendor');
    assert.equal(checklistText('-[] call vendor'), 'call vendor');
  });

  it('leaves unmarked entries untouched', () => {
    assert.equal(checklistText('call vendor'), 'call vendor');
  });
});

describe('taskSearchText', () => {
  it('includes subject, tags, remarks and checklist text', () => {
    const haystack = taskSearchText(task({
      subject: 'Ship Release',
      categories: ['Infra'],
      remarks: { type: 'text', content: 'Coordinate with Ops' },
      checklist: ['-[x] Tag build'],
    }));

    assert.ok(haystack.includes('ship release'));
    assert.ok(haystack.includes('infra'));
    assert.ok(haystack.includes('coordinate with ops'));
    assert.ok(haystack.includes('tag build'));
  });

  it('indexes markdown remarks as rendered text, not as source', () => {
    const haystack = taskSearchText(task({
      subject: 'Ship Release',
      remarks: { type: 'markdown', content: '## Rollout\n\n- [Runbook](https://example.com/run) **ready**' },
    }));

    assert.ok(haystack.includes('rollout'));
    assert.ok(haystack.includes('runbook'));
    assert.ok(haystack.includes('ready'));
    // The link target stays searchable, as it was before remarks were
    // Markdown, but the syntax must not become a search term of its own.
    assert.ok(haystack.includes('https://example.com/run'));
    assert.equal(haystack.includes('**'), false);
    assert.equal(haystack.includes('##'), false);
  });

  it('excludes checklist markers so "x" does not match every checked entry', () => {
    const haystack = taskSearchText(task({ subject: 'Plan', checklist: ['-[x] done'] }));
    assert.equal(haystack.includes('-[x]'), false);
    assert.equal(matchesSearchTerms(task({ subject: 'Plan', checklist: ['-[x] done'] }), ['x']), false);
  });
});

describe('matchesSearchTerms', () => {
  const item = task({
    subject: 'Fix login redirect',
    categories: ['Auth'],
    remarks: { type: 'text', content: 'Only on Safari' },
  });

  it('matches with no terms', () => {
    assert.equal(matchesSearchTerms(item, []), true);
  });

  it('is case insensitive', () => {
    assert.equal(matchesSearchTerms(item, ['LOGIN'.toLocaleLowerCase()]), true);
  });

  it('combines multiple terms with AND across fields', () => {
    assert.equal(matchesSearchTerms(item, ['login', 'auth', 'safari']), true);
    assert.equal(matchesSearchTerms(item, ['login', 'chrome']), false);
  });
});

describe('filterTasks', () => {
  it('hides statuses set to hide and applies today-only to the relevant date', () => {
    const items = [
      task({ subject: 'cancelled item', status: 'cancelled' }),
      task({ subject: 'finished today', status: 'finished', finishDateTime: isoAt(0) }),
      task({ subject: 'finished earlier', status: 'finished', finishDateTime: isoAt(-3) }),
      task({ subject: 'new item', status: 'new', etsDateTime: isoAt(5) }),
    ];

    const result = filterTasks(items, query()).map(item => item.subject);
    assert.deepEqual(result, ['finished today', 'new item']);
  });

  it('treats a missing status as new', () => {
    const items = [task({ subject: 'no status', status: undefined })];
    assert.equal(filterTasks(items, query()).length, 1);
  });

  it('skips status filtering when applyStatusFilters is false', () => {
    const items = [task({ subject: 'cancelled item', status: 'cancelled' })];
    assert.equal(filterTasks(items, query()).length, 0);
    assert.equal(filterTasks(items, query(), { applyStatusFilters: false }).length, 1);
  });

  it('matches any selected tag and optionally untagged items', () => {
    const items = [
      task({ subject: 'tagged a', categories: ['a'] }),
      task({ subject: 'tagged b', categories: ['b'] }),
      task({ subject: 'untagged' }),
    ];

    assert.deepEqual(
      filterTasks(items, query({ categories: ['a'] })).map(i => i.subject),
      ['tagged a'],
    );
    assert.deepEqual(
      filterTasks(items, query({ categories: ['a'], includeUncategorized: true })).map(i => i.subject),
      ['tagged a', 'untagged'],
    );
    assert.deepEqual(
      filterTasks(items, query({ includeUncategorized: true })).map(i => i.subject),
      ['untagged'],
    );
  });

  it('treats an empty categories array as untagged', () => {
    const items = [task({ subject: 'empty tags', categories: [] })];
    assert.equal(filterTasks(items, query({ includeUncategorized: true })).length, 1);
    assert.equal(filterTasks(items, query({ categories: ['a'] })).length, 0);
  });

  it('applies urgent and important filters independently', () => {
    const items = [
      task({ subject: 'both', urgent: true, important: true }),
      task({ subject: 'urgent only', urgent: true }),
      task({ subject: 'important only', important: true }),
      task({ subject: 'neither' }),
    ];

    assert.deepEqual(
      filterTasks(items, query({ urgentOnly: true })).map(i => i.subject),
      ['both', 'urgent only'],
    );
    assert.deepEqual(
      filterTasks(items, query({ urgentOnly: true, importantOnly: true })).map(i => i.subject),
      ['both'],
    );
  });

  it('composes search text with structured filters', () => {
    const items = [
      task({ subject: 'deploy api', categories: ['infra'], urgent: true }),
      task({ subject: 'deploy docs', categories: ['infra'] }),
      task({ subject: 'write api docs', categories: ['writing'], urgent: true }),
    ];

    assert.deepEqual(
      filterTasks(items, query({ text: 'deploy', categories: ['infra'], urgentOnly: true }))
        .map(i => i.subject),
      ['deploy api'],
    );
  });

  it('respects an injected now for today-only filtering', () => {
    // Built from local calendar parts: "today" is a local-day comparison, so
    // fixed UTC instants would straddle midnight in some time zones.
    const now = new Date(2024, 2, 10, 12, 0, 0);
    const earlierSameDay = new Date(2024, 2, 10, 8, 0, 0);
    const items = [
      task({ subject: 'finished then', status: 'finished', finishDateTime: earlierSameDay.toISOString() }),
    ];
    assert.equal(filterTasks(items, query(), { now }).length, 1);
    assert.equal(
      filterTasks(items, query(), { now: new Date(2024, 2, 20, 12, 0, 0) }).length,
      0,
    );
  });
});

describe('isStatusFilterActive / isQueryActive', () => {
  it('is inactive for the defaults it is compared against', () => {
    assert.equal(isStatusFilterActive(query()), false);
    assert.equal(isQueryActive(query()), false);
  });

  it('detects deviation from the supplied defaults', () => {
    const showAll = createDefaultTaskQuery(SHOW_ALL_STATUS_FILTERS);
    assert.equal(isStatusFilterActive(showAll), true);
    assert.equal(isStatusFilterActive(showAll, SHOW_ALL_STATUS_FILTERS), false);
    assert.equal(isQueryActive(showAll, SHOW_ALL_STATUS_FILTERS), false);
  });

  it('treats whitespace-only search text as inactive', () => {
    assert.equal(isQueryActive(query({ text: '   ' })), false);
    assert.equal(isQueryActive(query({ text: 'x' })), true);
  });

  it('detects tag and priority filters', () => {
    assert.equal(isQueryActive(query({ categories: ['a'] })), true);
    assert.equal(isQueryActive(query({ includeUncategorized: true })), true);
    assert.equal(isQueryActive(query({ importantOnly: true })), true);
  });
});

describe('taskQueriesEqual', () => {
  it('ignores search text formatting differences', () => {
    assert.equal(taskQueriesEqual(query({ text: 'Fix  API' }), query({ text: ' fix api ' })), true);
  });

  it('ignores search term order and duplicates', () => {
    assert.equal(taskQueriesEqual(query({ text: 'api fix' }), query({ text: 'fix api' })), true);
    assert.equal(taskQueriesEqual(query({ text: 'fix fix api' }), query({ text: 'fix api' })), true);
  });

  it('detects a differing search term', () => {
    assert.equal(taskQueriesEqual(query({ text: 'api fix' }), query({ text: 'api ship' })), false);
  });

  it('ignores tag ordering', () => {
    assert.equal(taskQueriesEqual(query({ categories: ['a', 'b'] }), query({ categories: ['b', 'a'] })), true);
  });

  it('detects differing tags of equal length', () => {
    assert.equal(taskQueriesEqual(query({ categories: ['a'] }), query({ categories: ['b'] })), false);
  });

  it('detects status, priority and untagged differences', () => {
    assert.equal(
      taskQueriesEqual(
        query(),
        query({ statusFilters: { ...DEFAULT_STATUS_FILTERS, cancelled: 'showAll' } }),
      ),
      false,
    );
    assert.equal(taskQueriesEqual(query(), query({ urgentOnly: true })), false);
    assert.equal(taskQueriesEqual(query(), query({ includeUncategorized: true })), false);
  });
});
