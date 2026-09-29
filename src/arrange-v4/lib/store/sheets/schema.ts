import type { TodoItem, TodoItemWithId, TodoStatus } from '../types';
import { ALL_STATUSES } from '../types';

export const TODO_SHEET_NAME = 'TODOs';

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
  'deleted',
] as const;

export interface SheetTodoRecord {
  item: TodoItemWithId;
  rowNumber: number;
  createdAt: string;
  updatedAt: string;
  rawValues: unknown[];
  deleted: boolean;
}

function cellByHeader(headers: string[], row: unknown[], header: string): unknown {
  const index = headers.indexOf(header);
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

export function normalizeHeaders(headers: unknown[]): string[] {
  const normalized = headers.map(value => String(value || '').trim());
  for (const required of TODO_HEADERS) {
    if (!normalized.includes(required)) normalized.push(required);
  }
  return normalized;
}

export function parseSheetRows(values: unknown[][]): SheetTodoRecord[] {
  if (values.length < 2) return [];
  const headers = normalizeHeaders(values[0]);

  const latestById = new Map<string, SheetTodoRecord>();
  values.slice(1).forEach((row, index) => {
    const id = optionalString(cellByHeader(headers, row, 'id'));
    const subject = optionalString(cellByHeader(headers, row, 'subject'));
    if (!id) return;

    const createdAt = optionalString(cellByHeader(headers, row, 'createdAt')) || '';
    const updatedAt = optionalString(cellByHeader(headers, row, 'updatedAt')) || createdAt;
    const deleted = booleanCell(cellByHeader(headers, row, 'deleted'));
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
    latestById.set(id, {
      item,
      rowNumber: index + 2,
      createdAt,
      updatedAt,
      rawValues: row,
      deleted,
    });
  });

  return [...latestById.values()].filter(record => !record.deleted && !!record.item.subject);
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
  existingValues?: unknown[],
  deleted = false,
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
    deleted,
  };
  return headers.map((header, index) => (
    Object.prototype.hasOwnProperty.call(cells, header)
      ? cells[header]
      : existingValues?.[index] ?? ''
  ));
}
