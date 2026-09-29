import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeHeaders,
  parseSheetRows,
  serializeSheetRow,
  TODO_HEADERS,
} from './schema';
import type { TodoItemWithId } from '../types';

describe('Google Sheets TODO schema', () => {
  it('round-trips every persisted TODO field', () => {
    const item: TodoItemWithId = {
      id: 'todo-1',
      subject: 'Ship Google support',
      etsDateTime: '2026-09-29T01:00:00.000Z',
      etaDateTime: '2026-09-29T02:00:00.000Z',
      status: 'inProgress',
      urgent: true,
      important: true,
      categories: ['release'],
      checklist: ['test', 'deploy'],
      remarks: { type: 'markdown', content: '**Ready**' },
      startDateTime: '2026-09-29T01:05:00.000Z',
      finishDateTime: null,
      originalEtsDateTime: '2026-09-28T01:00:00.000Z',
      originalEtaDateTime: '2026-09-28T02:00:00.000Z',
      matrixOrder: 3,
      scrumOrder: 7,
    };
    const createdAt = '2026-09-28T23:00:00.000Z';
    const updatedAt = '2026-09-28T23:30:00.000Z';
    const headers = Array.from(TODO_HEADERS);
    const row = serializeSheetRow(headers, item, createdAt, updatedAt);

    const [record] = parseSheetRows([headers, row]);

    assert.deepEqual(record.item, item);
    assert.equal(record.createdAt, createdAt);
    assert.equal(record.updatedAt, updatedAt);
    assert.equal(record.rowNumber, 2);
  });

  it('extends the original 16-column schema without losing legacy rows', () => {
    const legacyHeaders = Array.from(TODO_HEADERS.slice(0, 16));
    const headers = normalizeHeaders(legacyHeaders);
    const legacyRow = [
      'legacy-id',
      'Legacy item',
      '',
      '',
      'new',
      false,
      true,
      '["legacy"]',
      '',
      '',
      '',
      '',
      '',
      '',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    ];

    const [record] = parseSheetRows([headers, legacyRow]);

    assert.equal(headers.at(-5), 'matrixOrder');
    assert.equal(headers.at(-4), 'scrumOrder');
    assert.equal(headers.at(-3), 'deleted');
    assert.equal(headers.at(-2), 'changedFields');
    assert.equal(headers.at(-1), 'operationId');
    assert.equal(record.item.id, 'legacy-id');
    assert.equal(record.item.important, true);
    assert.equal(record.item.matrixOrder, undefined);
    assert.equal(record.item.scrumOrder, undefined);
  });

  it('uses the latest appended version and hides tombstoned items', () => {
    const headers = Array.from(TODO_HEADERS);
    const original = serializeSheetRow(
      headers,
      { id: 'todo-1', subject: 'Original' },
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    );
    const updated = serializeSheetRow(
      headers,
      { id: 'todo-1', subject: 'Updated' },
      '2026-01-01T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
    );
    const tombstone = serializeSheetRow(
      headers,
      { id: 'todo-2', subject: 'Deleted' },
      '2026-01-01T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
      { deleted: true },
    );
    const deletedOriginal = serializeSheetRow(
      headers,
      { id: 'todo-2', subject: 'Deleted' },
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    );

    const records = parseSheetRows([
      headers,
      original,
      deletedOriginal,
      updated,
      tombstone,
    ]);

    assert.deepEqual(records.map(record => record.item), [
      {
        id: 'todo-1',
        subject: 'Updated',
        etsDateTime: undefined,
        etaDateTime: undefined,
        status: 'new',
        urgent: false,
        important: false,
        categories: undefined,
        checklist: undefined,
        remarks: null,
        startDateTime: null,
        finishDateTime: null,
        originalEtsDateTime: null,
        originalEtaDateTime: null,
        matrixOrder: undefined,
        scrumOrder: undefined,
      },
    ]);
  });

  it('merges concurrent field patches independently of row order', () => {
    const headers = Array.from(TODO_HEADERS);
    const base = serializeSheetRow(
      headers,
      { id: 'todo-1', subject: 'Original', urgent: false },
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
      { operationId: 'base' },
    );
    const subjectPatch = serializeSheetRow(
      headers,
      { id: 'todo-1', subject: 'Renamed', urgent: false },
      '2026-01-01T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
      { changedFields: ['subject'], operationId: 'subject' },
    );
    const urgencyPatch = serializeSheetRow(
      headers,
      { id: 'todo-1', subject: 'Original', urgent: true },
      '2026-01-01T00:00:00.000Z',
      '2026-01-03T00:00:00.000Z',
      { changedFields: ['urgent'], operationId: 'urgent' },
    );

    const [record] = parseSheetRows([headers, urgencyPatch, base, subjectPatch]);

    assert.equal(record.item.subject, 'Renamed');
    assert.equal(record.item.urgent, true);
  });

  it('keeps tombstones terminal even when a stale patch is appended later', () => {
    const headers = Array.from(TODO_HEADERS);
    const base = serializeSheetRow(
      headers,
      { id: 'todo-1', subject: 'Original' },
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    );
    const tombstone = serializeSheetRow(
      headers,
      { id: 'todo-1', subject: 'Original' },
      '2026-01-01T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
      { deleted: true },
    );
    const stalePatch = serializeSheetRow(
      headers,
      { id: 'todo-1', subject: 'Resurrected' },
      '2026-01-01T00:00:00.000Z',
      '2026-01-03T00:00:00.000Z',
      { changedFields: ['subject'] },
    );

    assert.deepEqual(parseSheetRows([headers, base, tombstone, stalePatch]), []);
  });
});
