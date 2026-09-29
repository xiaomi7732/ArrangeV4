import type { TodoItem, TodoItemWithId, TodoStatus } from '../types';
import { ALL_STATUSES } from '../types';

export const TODO_SHEET_NAME = 'TODOs';
export const TODO_METADATA_HEADER = '__arrange_metadata';

export const TODO_HEADERS = [
  'id',
  'subject',
  'etsDateTime',
  'etaDateTime',
  'status',
  'urgent',
  'important',
  'categories',
  'checklist',
  'remarks',
  'startDateTime',
  'finishDateTime',
  'originalEtsDateTime',
  'originalEtaDateTime',
  'createdAt',
  'updatedAt',
  'matrixOrder',
  'scrumOrder',
  TODO_METADATA_HEADER,
] as const;

export interface SheetTodoRecord {
  item: TodoItemWithId;
  rowNumber: number;
  createdAt: string;
  updatedAt: string;
  rawValues: unknown[];
  deleted: boolean;
  fieldOperations: Partial<Record<keyof TodoItem, string>>;
}

const TODO_FIELD_NAMES = [
  'subject',
  'etsDateTime',
  'etaDateTime',
  'status',
  'urgent',
  'important',
  'categories',
  'checklist',
  'remarks',
  'startDateTime',
  'finishDateTime',
  'originalEtsDateTime',
  'originalEtaDateTime',
  'matrixOrder',
  'scrumOrder',
] as const satisfies readonly (keyof TodoItem)[];

interface SheetTodoVersion extends SheetTodoRecord {
  changedFields: (keyof TodoItem)[] | null;
  operationId: string;
  parentOperations: Partial<Record<keyof TodoItem, string>>;
}

interface SheetMetadata {
  schemaVersion: 1;
  deleted?: boolean;
  changedFields?: (keyof TodoItem)[];
  operationId: string;
  parentOperations?: Partial<Record<keyof TodoItem, string>>;
}

function cellByHeader(headers: string[], row: unknown[], header: string): unknown {
  const index = headers.indexOf(header);
  return index >= 0 ? row[index] : undefined;
}

function cellByLastHeader(headers: string[], row: unknown[], header: string): unknown {
  const index = headers.lastIndexOf(header);
  return index >= 0 ? row[index] : undefined;
}

function optionalString(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  return String(value);
}

function nullableString(value: unknown): string | null {
  return optionalString(value) ?? null;
}

function booleanCell(value: unknown): boolean {
  return value === true || String(value).toLowerCase() === 'true';
}

function numberCell(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function jsonArrayCell(value: unknown): string[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(String(value));
    if (!Array.isArray(parsed)) return undefined;
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return undefined;
  }
}

function metadataCell(value: unknown): SheetMetadata | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(String(value)) as Partial<SheetMetadata>;
    if (
      parsed.schemaVersion !== 1
      || typeof parsed.operationId !== 'string'
      || !parsed.operationId.trim()
      || (parsed.deleted !== undefined && typeof parsed.deleted !== 'boolean')
      || (parsed.changedFields !== undefined && !Array.isArray(parsed.changedFields))
      || (
        parsed.parentOperations !== undefined
        && (
          !parsed.parentOperations
          || typeof parsed.parentOperations !== 'object'
          || Array.isArray(parsed.parentOperations)
        )
      )
    ) {
      return null;
    }
    const validFields = new Set<string>(TODO_FIELD_NAMES);
    if (
      Array.isArray(parsed.changedFields)
      && parsed.changedFields.some(
        field => typeof field !== 'string' || !validFields.has(field),
      )
    ) return null;
    if (
      parsed.parentOperations
      && Object.entries(parsed.parentOperations).some(
        ([field, operation]) =>
          !validFields.has(field) || typeof operation !== 'string' || !operation,
      )
    ) return null;
    const changedFields = Array.isArray(parsed.changedFields)
      ? parsed.changedFields.filter(
        (field): field is keyof TodoItem =>
          typeof field === 'string' && validFields.has(field),
      )
      : undefined;
    const parentOperations = parsed.parentOperations
      ? Object.fromEntries(Object.entries(parsed.parentOperations).filter(
        (entry): entry is [keyof TodoItem, string] =>
          validFields.has(entry[0]) && typeof entry[1] === 'string',
      ))
      : undefined;
    return {
      schemaVersion: 1,
      operationId: parsed.operationId,
      deleted: parsed.deleted === true,
      changedFields,
      parentOperations,
    };
  } catch {
    return null;
  }
}

function looksLikeArrangeMetadata(value: unknown): boolean {
  if (typeof value !== 'string' || !value) return false;
  try {
    const parsed = JSON.parse(value) as { schemaVersion?: unknown };
    return !!parsed
      && typeof parsed === 'object'
      && typeof parsed.schemaVersion === 'number';
  } catch {
    return false;
  }
}

function previousMetadataCell(headers: string[], row: unknown[]): SheetMetadata | null {
  const requiredHeaders = ['deleted', 'changedFields', 'operationId', 'parentOperations'];
  const metadataIndex = headers.lastIndexOf(TODO_METADATA_HEADER);
  if (
    metadataIndex < requiredHeaders.length
    || requiredHeaders.some(
      (header, index) => headers[metadataIndex - requiredHeaders.length + index] !== header,
    )
  ) return null;
  const operationId = optionalString(cellByHeader(headers, row, 'operationId'));
  if (!operationId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
    return null;
  }

  const deletedValue = cellByHeader(headers, row, 'deleted');
  const deletedText = String(deletedValue ?? '').toLowerCase();
  if (deletedValue !== '' && deletedValue !== undefined && deletedValue !== null
    && deletedValue !== true && deletedValue !== false
    && deletedText !== 'true' && deletedText !== 'false') {
    return null;
  }

  const changedFieldsValue = cellByHeader(headers, row, 'changedFields');
  const changedFields = changedFieldsValue
    ? jsonArrayCell(changedFieldsValue)
    : undefined;
  const validFields = new Set<string>(TODO_FIELD_NAMES);
  if (
    changedFieldsValue
    && (
      !changedFields
      || changedFields.some(field => !validFields.has(field))
    )
  ) return null;

  let parentOperations: Partial<Record<keyof TodoItem, string>> | undefined;
  const parentValue = cellByHeader(headers, row, 'parentOperations');
  if (parentValue) {
    try {
      const parsed = JSON.parse(String(parentValue)) as Record<string, unknown>;
      if (
        !parsed
        || typeof parsed !== 'object'
        || Array.isArray(parsed)
        || Object.entries(parsed).some(
          ([field, operation]) =>
            !validFields.has(field) || typeof operation !== 'string' || !operation,
        )
      ) return null;
      parentOperations = parsed as Partial<Record<keyof TodoItem, string>>;
    } catch {
      return null;
    }
  }

  return {
    schemaVersion: 1,
    operationId,
    deleted: deletedValue === true || deletedText === 'true',
    changedFields: changedFields as (keyof TodoItem)[] | undefined,
    parentOperations,
  };
}

function remarksCell(value: unknown): TodoItem['remarks'] {
  if (!value) return null;
  try {
    const parsed = JSON.parse(String(value)) as Partial<NonNullable<TodoItem['remarks']>>;
    if (
      (parsed.type === 'text' || parsed.type === 'markdown')
      && typeof parsed.content === 'string'
    ) {
      return { type: parsed.type, content: parsed.content };
    }
  } catch {
    // Invalid user-edited JSON is treated as absent rather than breaking the book.
  }
  return null;
}

function statusCell(value: unknown): TodoStatus {
  const status = String(value || 'new') as TodoStatus;
  return ALL_STATUSES.includes(status) ? status : 'new';
}

export function normalizeHeaders(headers: unknown[], rows: unknown[][] = []): string[] {
  const normalized = headers.map(value => String(value || '').trim());
  for (const required of TODO_HEADERS) {
    if (required === TODO_METADATA_HEADER) continue;
    if (!normalized.includes(required)) normalized.push(required);
  }
  const metadataIndices = normalized.flatMap((header, index) => (
    header === TODO_METADATA_HEADER ? [index] : []
  ));
  const canonicalNewSheet = normalized.length === TODO_HEADERS.length
    && TODO_HEADERS.every((header, index) => normalized[index] === header);
  const hasVersionedValues = metadataIndices.some(index =>
    rows.some(row => metadataCell(row[index]) !== null)
  );
  const hasArrangeMarker = metadataIndices.some(index =>
    rows.some(row => looksLikeArrangeMetadata(row[index]))
  );
  const canonicalMetadataIsManaged = canonicalNewSheet && (
    rows.length === 0
    || rows.every(row => row[metadataIndices[0]] === undefined || row[metadataIndices[0]] === '')
    || hasVersionedValues
    || hasArrangeMarker
  );
  if (
    metadataIndices.length === 0
    || (
      metadataIndices.length === 1
      && !canonicalMetadataIsManaged
      && !hasVersionedValues
    )
  ) {
    normalized.push(TODO_METADATA_HEADER);
  }
  return normalized;
}

export function parseSheetRows(values: unknown[][]): SheetTodoRecord[] {
  if (values.length < 2) return [];
  const headers = normalizeHeaders(values[0], values.slice(1));

  const versionsById = new Map<string, SheetTodoVersion[]>();
  values.slice(1).forEach((row, index) => {
    const id = optionalString(cellByHeader(headers, row, 'id'));
    const subject = optionalString(cellByHeader(headers, row, 'subject'));
    if (!id) return;

    const createdAt = optionalString(cellByHeader(headers, row, 'createdAt')) || '';
    const updatedAt = optionalString(cellByHeader(headers, row, 'updatedAt')) || createdAt;
    const rawMetadata = cellByLastHeader(headers, row, TODO_METADATA_HEADER);
    const hasRawMetadata = rawMetadata !== undefined
      && rawMetadata !== null
      && rawMetadata !== '';
    const versionedMetadata = metadataCell(rawMetadata);
    if (hasRawMetadata && !versionedMetadata) return;
    const metadata = versionedMetadata || previousMetadataCell(headers, row);
    if (metadata && !metadata.deleted && !metadata.changedFields && !subject) return;
    const deleted = metadata?.deleted === true;
    const changedFields = metadata?.changedFields ?? null;
    const operationId = metadata?.operationId || `legacy:${id}`;
    const parentOperations = {
      operations: metadata?.parentOperations || {},
    };
    for (const field of TODO_FIELD_NAMES) {
      const parent = parentOperations.operations[field];
      if (parent?.startsWith(`legacy:${id}:`)) {
        parentOperations.operations[field] = `legacy:${id}`;
      }
    }
    if (
      changedFields !== null
      && changedFields.some(field => !parentOperations.operations[field])
      && !deleted
    ) return;
    const item: TodoItemWithId = {
      id,
      subject: subject || '',
      etsDateTime: optionalString(cellByHeader(headers, row, 'etsDateTime')),
      etaDateTime: optionalString(cellByHeader(headers, row, 'etaDateTime')),
      status: statusCell(cellByHeader(headers, row, 'status')),
      urgent: booleanCell(cellByHeader(headers, row, 'urgent')),
      important: booleanCell(cellByHeader(headers, row, 'important')),
      categories: jsonArrayCell(cellByHeader(headers, row, 'categories')),
      checklist: jsonArrayCell(cellByHeader(headers, row, 'checklist')),
      remarks: remarksCell(cellByHeader(headers, row, 'remarks')),
      startDateTime: nullableString(cellByHeader(headers, row, 'startDateTime')),
      finishDateTime: nullableString(cellByHeader(headers, row, 'finishDateTime')),
      originalEtsDateTime: nullableString(cellByHeader(headers, row, 'originalEtsDateTime')),
      originalEtaDateTime: nullableString(cellByHeader(headers, row, 'originalEtaDateTime')),
      matrixOrder: numberCell(cellByHeader(headers, row, 'matrixOrder')),
      scrumOrder: numberCell(cellByHeader(headers, row, 'scrumOrder')),
    };
    const version: SheetTodoVersion = {
      item,
      rowNumber: index + 2,
      createdAt,
      updatedAt,
      rawValues: row,
      deleted,
      fieldOperations: {},
      changedFields: deleted ? [] : changedFields,
      operationId,
      parentOperations: parentOperations.operations,
    };
    const versions = versionsById.get(id) || [];
    versions.push(version);
    versionsById.set(id, versions);
  });

  return [...versionsById.values()].flatMap(versions => {
    if (versions.some(version => version.deleted)) return [];

    interface FieldNode {
      operationId: string;
      parentOperationId: string | null;
      value: TodoItem[keyof TodoItem];
    }
    const nodesByField = new Map<keyof TodoItem, Map<string, FieldNode>>();
    for (const version of versions) {
      const fields = version.changedFields ?? [...TODO_FIELD_NAMES];
      for (const field of fields) {
        const nodes = nodesByField.get(field) || new Map<string, FieldNode>();
        nodes.set(version.operationId, {
          operationId: version.operationId,
          parentOperationId: version.changedFields === null
            ? null
            : version.parentOperations[field] || null,
          value: version.item[field],
        });
        nodesByField.set(field, nodes);
      }
    }

    const item = { id: versions[0].item.id } as TodoItemWithId;
    const fieldOperations: Partial<Record<keyof TodoItem, string>> = {};
    for (const field of TODO_FIELD_NAMES) {
      const nodes = nodesByField.get(field);
      if (!nodes) continue;
      const depths = new Map<string, number>();
      const visiting = new Set<string>();
      const depth = (node: FieldNode): number => {
        const cached = depths.get(node.operationId);
        if (cached !== undefined) return cached;
        if (visiting.has(node.operationId)) return -1;
        if (!node.parentOperationId) return 0;
        const parent = nodes.get(node.parentOperationId);
        if (!parent) return -1;
        visiting.add(node.operationId);
        const parentDepth = depth(parent);
        visiting.delete(node.operationId);
        const result = parentDepth < 0 ? -1 : parentDepth + 1;
        depths.set(node.operationId, result);
        return result;
      };
      const winner = [...nodes.values()]
        .map(node => ({ node, depth: depth(node) }))
        .filter(candidate => candidate.depth >= 0)
        .sort((left, right) => (
          right.depth - left.depth
          || right.node.operationId.localeCompare(left.node.operationId)
        ))[0]?.node;
      if (!winner) continue;
      Object.assign(item, { [field]: winner.value });
      fieldOperations[field] = winner.operationId;
    }
    if (!item.subject) return [];
    const representative = versions.reduce((latest, version) => (
      version.operationId > latest.operationId ? version : latest
    ));
    return [{
      ...representative,
      item,
      fieldOperations,
      createdAt: versions.find(version => version.createdAt)?.createdAt || '',
    }];
  });
}

function jsonCell(value: unknown[] | TodoItem['remarks']): string {
  return value && (!Array.isArray(value) || value.length > 0)
    ? JSON.stringify(value)
    : '';
}

export function serializeSheetRow(
  headers: string[],
  item: TodoItemWithId,
  createdAt: string,
  updatedAt: string,
  options: {
    changedFields?: (keyof TodoItem)[];
    deleted?: boolean;
    operationId?: string;
    parentOperations?: Partial<Record<keyof TodoItem, string>>;
  } = {},
): unknown[] {
  const cells: Record<string, unknown> = {
    id: item.id,
    subject: item.subject,
    etsDateTime: item.etsDateTime || '',
    etaDateTime: item.etaDateTime || '',
    status: item.status || 'new',
    urgent: item.urgent || false,
    important: item.important || false,
    categories: jsonCell(item.categories),
    checklist: jsonCell(item.checklist),
    remarks: jsonCell(item.remarks),
    startDateTime: item.startDateTime || '',
    finishDateTime: item.finishDateTime || '',
    originalEtsDateTime: item.originalEtsDateTime || '',
    originalEtaDateTime: item.originalEtaDateTime || '',
    createdAt,
    updatedAt,
    matrixOrder: item.matrixOrder ?? '',
    scrumOrder: item.scrumOrder ?? '',
    [TODO_METADATA_HEADER]: JSON.stringify({
      schemaVersion: 1,
      operationId: options.operationId || crypto.randomUUID(),
      ...(options.deleted ? { deleted: true } : {}),
      ...(options.changedFields ? { changedFields: options.changedFields } : {}),
      ...(options.parentOperations
        ? { parentOperations: options.parentOperations }
        : {}),
    } satisfies SheetMetadata),
  };
  const changedFields = options.changedFields
    ? new Set<string>(options.changedFields)
    : null;
  const metadataIndex = headers.lastIndexOf(TODO_METADATA_HEADER);
  return headers.map((header, index) => {
    if (header === TODO_METADATA_HEADER && index !== metadataIndex) return '';
    if (changedFields && (TODO_FIELD_NAMES as readonly string[]).includes(header)) {
      return changedFields.has(header) ? cells[header] : '';
    }
    return Object.prototype.hasOwnProperty.call(cells, header) ? cells[header] : '';
  });
}
