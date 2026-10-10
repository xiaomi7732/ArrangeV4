/**
 * The shape Arrange stores in a calendar event body, and the check that says
 * whether what came back is really that shape.
 *
 * Note: this module is compiled by tsconfig.test.json, which does not rewrite
 * the "@/" path alias, so imports here must stay relative.
 */
import type { TodoItem } from '../types';

export interface StoredTodoBody {
  status: string;
  urgent: boolean;
  important: boolean;
  checklist: string[];
  remarks: TodoItem['remarks'];
  startDateTime: string | null;
  finishDateTime: string | null;
  /**
   * The task's real ETS/ETA. The event's own start/end is only the window
   * anchor, which Arrange rolls forward to keep stale items inside the
   * calendarView window, so it cannot be trusted as the planned dates.
   * Absent on items written before anchoring was separated from planning.
   */
  etsDateTime: string | null;
  etaDateTime: string | null;
  /**
   * Where Arrange last put the event. When the event has since moved, it was
   * rescheduled outside Arrange (in Outlook, say) and that wins over the
   * planned dates above.
   */
  anchorStartDateTime: string | null;
  anchorEndDateTime: string | null;
  /**
   * Pre-bump dates recorded by the old behaviour, where rolling an item
   * forward overwrote its ETS/ETA. No longer written; still read so a legacy
   * item hands back the dates the user actually chose.
   */
  originalEtsDateTime: string | null;
  originalEtaDateTime: string | null;
  matrixOrder?: number;
  scrumOrder?: number;
}

export const STORED_BODY_FIELDS: readonly (keyof StoredTodoBody)[] = [
  'status',
  'urgent',
  'important',
  'checklist',
  'remarks',
  'startDateTime',
  'finishDateTime',
  'etsDateTime',
  'etaDateTime',
  'anchorStartDateTime',
  'anchorEndDateTime',
  'originalEtsDateTime',
  'originalEtaDateTime',
  'matrixOrder',
  'scrumOrder',
];

const STATUSES = new Set(['new', 'inProgress', 'blocked', 'finished', 'cancelled']);
const REMARK_TYPES = new Set(['text', 'markdown']);

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function isStringList(value: unknown): boolean {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string');
}

function isRemarks(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'object') return false;
  const remarks = value as { type?: unknown; content?: unknown };
  return typeof remarks.content === 'string'
    && typeof remarks.type === 'string'
    && REMARK_TYPES.has(remarks.type);
}

function isOrder(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

const FIELD_CHECKS: Record<keyof StoredTodoBody, (value: unknown) => boolean> = {
  status: value => typeof value === 'string' && STATUSES.has(value),
  urgent: value => typeof value === 'boolean',
  important: value => typeof value === 'boolean',
  checklist: isStringList,
  remarks: isRemarks,
  startDateTime: isNullableString,
  finishDateTime: isNullableString,
  etsDateTime: isNullableString,
  etaDateTime: isNullableString,
  anchorStartDateTime: isNullableString,
  anchorEndDateTime: isNullableString,
  originalEtsDateTime: isNullableString,
  originalEtaDateTime: isNullableString,
  matrixOrder: isOrder,
  scrumOrder: isOrder,
};

export function hasAnyStoredField(data: Partial<StoredTodoBody>): boolean {
  return STORED_BODY_FIELDS.some(field => field in data);
}

/**
 * Says what is wrong with a parsed payload, or null when it is usable.
 *
 * Valid JSON is not the same as Arrange data: a payload that parses but holds
 * a status nobody recognises, or a checklist that is not a list of strings,
 * would otherwise be assigned straight onto the item — the task would quietly
 * vanish from every Scrum lane, and the next edit would write the damage back
 * as if it were the user's own data. Treating it as unreadable keeps it on
 * screen and refuses to overwrite it.
 */
export function describeStoredFieldDamage(data: Partial<StoredTodoBody>): string | null {
  if (!hasAnyStoredField(data)) {
    // Arrange never writes a payload without its own fields.
    return 'payload has no Arrange fields';
  }

  const record = data as Record<string, unknown>;
  for (const field of STORED_BODY_FIELDS) {
    if (!(field in record)) continue;
    const value = record[field];
    // An explicitly absent optional field is not damage.
    if (value === undefined) continue;
    if (!FIELD_CHECKS[field](value)) return `${field} is not valid Arrange data`;
  }

  return null;
}
