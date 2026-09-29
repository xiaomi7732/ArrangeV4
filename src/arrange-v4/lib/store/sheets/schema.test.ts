import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeHeaders,
  parseSheetRows,
  serializeSheetRow,
  TODO_HEADERS,
  TODO_METADATA_HEADER,
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

    assert.equal(headers.at(-3), 'matrixOrder');
    assert.equal(headers.at(-2), 'scrumOrder');
    assert.equal(headers.at(-1), TODO_METADATA_HEADER);
    assert.equal(record.item.id, 'legacy-id');
    assert.equal(record.item.important, true);
    assert.equal(record.item.matrixOrder, undefined);
    assert.equal(record.item.scrumOrder, undefined);
  });

  it('does not reinterpret generic custom columns as revision metadata', () => {
    const headers = normalizeHeaders([
      ...TODO_HEADERS.slice(0, 16),
      'deleted',
      'changedFields',
      'operationId',
      'parentOperations',
    ]);
    const row = [
      'legacy-id', 'Legacy item', '', '', 'new', false, false,
      '', '', '', '', '', '', '', '', '',
      true, 'not-json', 'custom-operation', '{"subject":"custom"}',
    ];

    const [record] = parseSheetRows([headers, row]);

    assert.equal(record.item.id, 'legacy-id');
    assert.equal(record.item.subject, 'Legacy item');
  });

  it('uses the latest appended version and hides tombstoned items', () => {
    const headers = Array.from(TODO_HEADERS);
    const original = serializeSheetRow(
      headers,
      { id: 'todo-1', subject: 'Original' },
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
      { operationId: 'base' },
    );
    const updated = serializeSheetRow(
      headers,
      { id: 'todo-1', subject: 'Updated' },
      '2026-01-01T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
      {
        changedFields: ['subject'],
        operationId: 'updated',
        parentOperations: { subject: 'base' },
      },
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
      { operationId: 'deleted-base' },
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
      {
        changedFields: ['subject'],
        operationId: 'subject',
        parentOperations: { subject: 'base' },
      },
    );
    const urgencyPatch = serializeSheetRow(
      headers,
      { id: 'todo-1', subject: 'Original', urgent: true },
      '2026-01-01T00:00:00.000Z',
      '2026-01-03T00:00:00.000Z',
      {
        changedFields: ['urgent'],
        operationId: 'urgent',
        parentOperations: { urgent: 'base' },
      },
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

  it('ignores patches with malformed changed-field metadata', () => {
    const headers = Array.from(TODO_HEADERS);
    const base = serializeSheetRow(
      headers,
      { id: 'todo-1', subject: 'Original', urgent: false },
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
      { operationId: 'base' },
    );
    const patch = serializeSheetRow(
      headers,
      { id: 'todo-1', subject: 'Original', urgent: true },
      '2026-01-01T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
      {
        changedFields: ['urgent'],
        operationId: 'patch',
        parentOperations: { urgent: 'base' },
      },
    );
    patch[headers.indexOf(TODO_METADATA_HEADER)] = 'not-json';

    const [record] = parseSheetRows([headers, base, patch]);

    assert.equal(record.item.subject, 'Original');
    assert.equal(record.item.urgent, false);
  });

  it('ignores structurally invalid versioned patch metadata', () => {
    const headers = Array.from(TODO_HEADERS);
    const base = serializeSheetRow(
      headers,
      { id: 'todo-1', subject: 'Original', urgent: false },
      '',
      '',
      { operationId: 'base' },
    );
    const patch = serializeSheetRow(
      headers,
      { id: 'todo-1', subject: 'Original', urgent: true },
      '',
      '',
      {
        changedFields: ['urgent'],
        operationId: 'patch',
        parentOperations: { urgent: 'base' },
      },
    );
    const metadataIndex = headers.indexOf(TODO_METADATA_HEADER);
    const metadata = JSON.parse(String(patch[metadataIndex])) as Record<string, unknown>;
    metadata.changedFields = 'urgent';
    patch[metadataIndex] = JSON.stringify(metadata);

    const [record] = parseSheetRows([headers, base, patch]);

    assert.equal(record.item.subject, 'Original');
    assert.equal(record.item.urgent, false);
  });

  it('quarantines unsupported snapshot and tombstone metadata', () => {
    const headers = Array.from(TODO_HEADERS);
    const base = serializeSheetRow(
      headers,
      { id: 'todo-1', subject: 'Original', urgent: true, important: true },
      '',
      '',
      { operationId: 'base' },
    );
    const unsupportedSnapshot = serializeSheetRow(
      headers,
      { id: 'todo-1', subject: 'Renamed' },
      '',
      '',
      { operationId: 'snapshot' },
    );
    const malformedTombstone = serializeSheetRow(
      headers,
      { id: 'todo-1', subject: 'Original' },
      '',
      '',
      { deleted: true, operationId: 'delete' },
    );
    const metadataIndex = headers.indexOf(TODO_METADATA_HEADER);
    const unsupported = JSON.parse(
      String(unsupportedSnapshot[metadataIndex]),
    ) as Record<string, unknown>;
    unsupported.schemaVersion = 2;
    unsupportedSnapshot[metadataIndex] = JSON.stringify(unsupported);
    malformedTombstone[metadataIndex] = JSON.stringify({
      schemaVersion: 1,
      operationId: '',
      deleted: 'true',
    });

    const [record] = parseSheetRows([
      headers,
      base,
      unsupportedSnapshot,
      malformedTombstone,
    ]);

    assert.equal(record.item.subject, 'Original');
    assert.equal(record.item.urgent, true);
    assert.equal(record.item.important, true);
  });

  it('quarantines falsy non-empty metadata cells', () => {
    const headers = Array.from(TODO_HEADERS);
    const base = serializeSheetRow(
      headers,
      { id: 'todo-1', subject: 'Original', urgent: true },
      '',
      '',
      { operationId: 'base' },
    );
    const falseMetadata = [...base];
    const zeroMetadata = [...base];
    const metadataIndex = headers.indexOf(TODO_METADATA_HEADER);
    falseMetadata[metadataIndex] = false;
    zeroMetadata[metadataIndex] = 0;

    assert.deepEqual(parseSheetRows([headers, falseMetadata]), []);
    assert.deepEqual(parseSheetRows([headers, zeroMetadata]), []);
  });

  it('ignores parentless patches rather than treating them as snapshots', () => {
    const headers = Array.from(TODO_HEADERS);
    const base = serializeSheetRow(
      headers,
      { id: 'todo-1', subject: 'Original' },
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
      { operationId: 'z-base' },
    );
    const parentlessPatch = serializeSheetRow(
      headers,
      { id: 'todo-1', subject: 'Unsafe patch' },
      '2026-01-01T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
      { changedFields: ['subject'], operationId: 'a-patch' },
    );

    const [record] = parseSheetRows([headers, base, parentlessPatch]);

    assert.equal(record.item.subject, 'Original');
  });

  it('follows parent revisions instead of client timestamps or row order', () => {
    const headers = Array.from(TODO_HEADERS);
    const base = serializeSheetRow(
      headers,
      { id: 'todo-1', subject: 'Base' },
      '2026-01-01T00:00:00.000Z',
      '2099-01-01T00:00:00.000Z',
      { operationId: 'z-base' },
    );
    const first = serializeSheetRow(
      headers,
      { id: 'todo-1', subject: 'First' },
      '2026-01-01T00:00:00.000Z',
      '2025-01-01T00:00:00.000Z',
      {
        changedFields: ['subject'],
        operationId: 'a-first',
        parentOperations: { subject: 'z-base' },
      },
    );
    const second = serializeSheetRow(
      headers,
      { id: 'todo-1', subject: 'Second' },
      '2026-01-01T00:00:00.000Z',
      '2024-01-01T00:00:00.000Z',
      {
        changedFields: ['subject'],
        operationId: 'b-second',
        parentOperations: { subject: 'a-first' },
      },
    );

    const [record] = parseSheetRows([headers, second, base, first]);

    assert.equal(record.item.subject, 'Second');
  });

  it('keeps legacy revision identity stable when rows move', () => {
    const legacyHeaders = Array.from(TODO_HEADERS.slice(0, 16));
    const headers = normalizeHeaders(legacyHeaders);
    const base = [
      'todo-1', 'Base', '', '', 'new', false, false,
      '', '', '', '', '', '', '', '', '',
    ];
    const patch = serializeSheetRow(
      headers,
      { id: 'todo-1', subject: 'Updated' },
      '',
      '',
      {
        changedFields: ['subject'],
        operationId: 'patch',
        parentOperations: { subject: 'legacy:todo-1' },
      },
    );

    const [beforeMove] = parseSheetRows([headers, base, patch]);
    const [afterMove] = parseSheetRows([headers, [], base, patch]);

    assert.equal(beforeMove.item.subject, 'Updated');
    assert.equal(afterMove.item.subject, 'Updated');
  });

  it('canonicalizes indexed legacy parent references', () => {
    const headers = normalizeHeaders(Array.from(TODO_HEADERS.slice(0, 16)));
    const base = [
      'todo-1', 'Base', '', '', 'new', false, false,
      '', '', '', '', '', '', '', '', '',
    ];
    const patch = serializeSheetRow(
      headers,
      { id: 'todo-1', subject: 'Edited' },
      '',
      '',
      {
        changedFields: ['subject'],
        operationId: 'patch',
        parentOperations: { subject: 'legacy:todo-1:0' },
      },
    );

    const [record] = parseSheetRows([headers, base, patch]);

    assert.equal(record.item.subject, 'Edited');
  });

  it('migrates the previous four-column revision format', () => {
    const headers = [
      ...TODO_HEADERS.slice(0, 18),
      'deleted',
      'changedFields',
      'operationId',
      'parentOperations',
    ];
    const makeRow = () => Array<unknown>(headers.length).fill('');
    const base = makeRow();
    base[headers.indexOf('id')] = 'todo-1';
    base[headers.indexOf('subject')] = 'Original';
    base[headers.indexOf('status')] = 'new';
    base[headers.indexOf('operationId')] = 'base';

    const patch = makeRow();
    patch[headers.indexOf('id')] = 'todo-1';
    patch[headers.indexOf('urgent')] = true;
    patch[headers.indexOf('changedFields')] = '["urgent"]';
    patch[headers.indexOf('operationId')] = 'patch';
    patch[headers.indexOf('parentOperations')] = '{"urgent":"base"}';

    const tombstone = makeRow();
    tombstone[headers.indexOf('id')] = 'todo-1';
    tombstone[headers.indexOf('subject')] = 'Original';
    tombstone[headers.indexOf('deleted')] = true;
    tombstone[headers.indexOf('operationId')] = 'delete';

    const [updated] = parseSheetRows([headers, base, patch]);
    assert.equal(updated.item.urgent, true);
    assert.deepEqual(parseSheetRows([headers, base, patch, tombstone]), []);
  });
});
