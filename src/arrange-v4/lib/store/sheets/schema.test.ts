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

    assert.equal(headers.at(-2), 'matrixOrder');
    assert.equal(headers.at(-1), 'scrumOrder');
    assert.equal(record.item.id, 'legacy-id');
    assert.equal(record.item.important, true);
    assert.equal(record.item.matrixOrder, undefined);
    assert.equal(record.item.scrumOrder, undefined);
  });
});
