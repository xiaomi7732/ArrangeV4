import { Client } from '@microsoft/microsoft-graph-client';
import { createGraphClient } from '@/lib/graphService';
import type {
  AcquireToken,
  Book,
  CreateBookOptions,
  ListItemsOptions,
  StoreOptions,
  TodoItem,
  TodoItemWithId,
  TodoStore,
} from '../types';
import { isNonTerminalStatus } from '../types';
import type { Calendar, CalendarEvent } from './types';
import { ARRANGE_SUFFIX, ARRANGE_SUFFIX_REGEX, calendarToBook, convertGraphDateTimeToISO, filterArrangeCalendars, getCalendarDisplayName } from './utils';
import { computeBumpedDates } from './bump';

const ARRANGE_DATA_START_MARKER = '====ArrangeDataStart====';
const ARRANGE_DATA_END_MARKER = '====ArrangeDataEnd====';

interface StoredTodoBody {
  status: string;
  urgent: boolean;
  important: boolean;
  checklist: string[];
  remarks: TodoItem['remarks'];
  startDateTime: string | null;
  finishDateTime: string | null;
  originalEtsDateTime: string | null;
  originalEtaDateTime: string | null;
}

/**
 * Implements TodoStore against the Microsoft Graph Calendar API.
 *
 * Each book is an Outlook calendar whose name ends with " by arrange".
 * Each item is a calendar event whose body holds a JSON blob between
 * `====ArrangeDataStart====` / `====ArrangeDataEnd====` markers.
 */
export class CalendarStore implements TodoStore {
  private readonly acquireToken: AcquireToken;

  constructor(opts: StoreOptions) {
    this.acquireToken = opts.acquireToken;
  }

  private async client(): Promise<Client> {
    const token = await this.acquireToken();
    return createGraphClient(token);
  }

  /* ---- Books ---- */

  async listBooks(): Promise<Book[]> {
    const client = await this.client();
    const all: Calendar[] = [];

    let response = await client.api('/me/calendars').top(100).get();
    all.push(...(response.value || []));
    while (response['@odata.nextLink']) {
      response = await client.api(response['@odata.nextLink']).get();
      all.push(...(response.value || []));
    }

    return filterArrangeCalendars(all)
      .map(calendarToBook)
      .filter((b): b is Book => b !== null);
  }

  async createBook(name: string, opts: CreateBookOptions): Promise<Book> {
    if (opts.backend !== 'calendar') {
      throw new Error(`CalendarStore cannot create a book with backend '${opts.backend}'.`);
    }
    const client = await this.client();
    // Case-insensitive suffix check so names like "Project by Arrange" don't get a
    // duplicate " by arrange" appended.
    const calendarName = ARRANGE_SUFFIX_REGEX.test(name) ? name : `${name}${ARRANGE_SUFFIX}`;
    const calendar: Calendar = await client.api('/me/calendars').post({ name: calendarName });
    const book = calendarToBook(calendar);
    if (!book) {
      throw new Error('Calendar creation returned no ID.');
    }
    return book;
  }

  async deleteBook(bookId: string): Promise<void> {
    const calendarId = unwrap(bookId);
    const client = await this.client();
    await client.api(`/me/calendars/${calendarId}`).delete();
  }

  /* ---- Items ---- */

  async listItems(bookId: string, opts: ListItemsOptions): Promise<TodoItemWithId[]> {
    const calendarId = unwrap(bookId);
    const client = await this.client();

    const events: CalendarEvent[] = [];

    if (opts.range === 'window') {
      if (!opts.fromDate || !opts.toDate) {
        throw new Error("listItems with range='window' requires fromDate and toDate.");
      }
      let response = await client
        .api(`/me/calendars/${calendarId}/calendarView`)
        .query({ startDateTime: opts.fromDate, endDateTime: opts.toDate })
        .top(100)
        .select('id,createdDateTime,lastModifiedDateTime,categories,subject,body,start,end')
        .get();
      events.push(...(response.value || []));
      while (response['@odata.nextLink']) {
        response = await client.api(response['@odata.nextLink']).get();
        events.push(...(response.value || []));
      }
    } else {
      // 'all'
      let response = await client
        .api(`/me/calendars/${calendarId}/events`)
        .top(100)
        .select('id,createdDateTime,lastModifiedDateTime,categories,subject,body,start,end')
        .get();
      events.push(...(response.value || []));
      while (response['@odata.nextLink']) {
        response = await client.api(response['@odata.nextLink']).get();
        events.push(...(response.value || []));
      }
    }

    return events
      .map(eventToTodoItem)
      .filter((i): i is TodoItemWithId => i !== null);
  }

  async createItem(bookId: string, item: TodoItem): Promise<TodoItemWithId> {
    const calendarId = unwrap(bookId);
    const client = await this.client();

    const status = item.status || 'new';
    const stored: StoredTodoBody = {
      status,
      urgent: item.urgent || false,
      important: item.important || false,
      checklist: item.checklist || [],
      remarks: item.remarks || null,
      startDateTime: status === 'inProgress' ? new Date().toISOString() : null,
      finishDateTime: null,
      originalEtsDateTime: null,
      originalEtaDateTime: null,
    };

    const now = new Date();
    const start = item.etsDateTime ? new Date(item.etsDateTime) : new Date(now.getTime() + 60 * 60 * 1000);
    const end = item.etaDateTime ? new Date(item.etaDateTime) : new Date(start.getTime() + 30 * 60 * 1000);

    const event = {
      subject: item.subject,
      body: { contentType: 'html', content: buildBodyHtml(stored) },
      start: { dateTime: start.toISOString(), timeZone: 'UTC' },
      end: { dateTime: end.toISOString(), timeZone: 'UTC' },
      categories: item.categories || [],
      reminderMinutesBeforeStart: 0,
      isReminderOn: false,
    };

    const created: CalendarEvent = await client.api(`/me/calendars/${calendarId}/events`).post(event);
    const parsed = eventToTodoItem(created);
    if (!parsed) throw new Error('Created event returned no ID.');
    return parsed;
  }

  async updateItem(bookId: string, itemId: string, updates: Partial<TodoItem>): Promise<TodoItemWithId> {
    const calendarId = unwrap(bookId);
    const client = await this.client();

    const existingEvent: CalendarEvent = await client
      .api(`/me/calendars/${calendarId}/events/${itemId}`)
      .get();

    let existingStored: StoredTodoBody = {
      status: 'new',
      urgent: false,
      important: false,
      checklist: [],
      remarks: null,
      startDateTime: null,
      finishDateTime: null,
      originalEtsDateTime: null,
      originalEtaDateTime: null,
    };
    if (existingEvent.body?.content) {
      const parsed = parseStoredBody(existingEvent.body);
      if (parsed) existingStored = { ...existingStored, ...parsed };
    }

    const merged: StoredTodoBody = {
      ...existingStored,
      status: updates.status !== undefined ? updates.status : existingStored.status,
      urgent: updates.urgent !== undefined ? updates.urgent : existingStored.urgent,
      important: updates.important !== undefined ? updates.important : existingStored.important,
      checklist: updates.checklist !== undefined ? updates.checklist : existingStored.checklist,
      remarks: updates.remarks !== undefined ? updates.remarks : existingStored.remarks,
    };

    // Timestamp transitions based on status changes
    if (updates.status !== undefined) {
      if (updates.status === 'inProgress' && !existingStored.startDateTime) {
        merged.startDateTime = new Date().toISOString();
      }
      if (updates.status === 'new') {
        merged.startDateTime = null;
      }
      if (updates.status === 'finished') {
        const now = new Date().toISOString();
        if (!existingStored.startDateTime) merged.startDateTime = now;
        if (!existingStored.finishDateTime) merged.finishDateTime = now;
      }
      if (updates.status !== 'finished' && existingStored.status === 'finished') {
        merged.finishDateTime = null;
      }
    }

    // Date-bump: move stale non-terminal items forward, preserving originals
    const effectiveStatus = (merged.status || 'new') as TodoItem['status'];
    const callerSetDates = updates.etsDateTime !== undefined || updates.etaDateTime !== undefined;
    let nextEts = updates.etsDateTime;
    let nextEta = updates.etaDateTime;

    if (isNonTerminalStatus(effectiveStatus) && !callerSetDates) {
      const currentEts = convertGraphDateTimeToISO(existingEvent.start);
      const currentEta = convertGraphDateTimeToISO(existingEvent.end);
      const bumped = computeBumpedDates(currentEts, currentEta);
      if (bumped) {
        if (!merged.originalEtsDateTime) merged.originalEtsDateTime = currentEts ?? null;
        if (!merged.originalEtaDateTime) merged.originalEtaDateTime = currentEta ?? null;
        nextEts = bumped.etsDateTime;
        nextEta = bumped.etaDateTime;
      }
    }

    const patch: Record<string, unknown> = {
      body: { contentType: 'html', content: buildBodyHtml(merged) },
    };
    if (updates.subject !== undefined) patch.subject = updates.subject;
    if (updates.categories !== undefined) patch.categories = updates.categories;
    if (nextEts !== undefined) {
      patch.start = { dateTime: new Date(nextEts).toISOString(), timeZone: 'UTC' };
    }
    if (nextEta !== undefined) {
      patch.end = { dateTime: new Date(nextEta).toISOString(), timeZone: 'UTC' };
    }

    const updated: CalendarEvent = await client
      .api(`/me/calendars/${calendarId}/events/${itemId}`)
      .patch(patch);

    const parsed = eventToTodoItem(updated);
    if (!parsed) throw new Error('Updated event returned no ID.');
    return parsed;
  }

  async deleteItem(bookId: string, itemId: string): Promise<void> {
    const calendarId = unwrap(bookId);
    const client = await this.client();
    await client.api(`/me/calendars/${calendarId}/events/${itemId}`).delete();
  }

  /* ---- Calendar-specific: not on the TodoStore interface ---- */

  /**
   * Bumps stale non-terminal items forward to today. Returns the IDs of items
   * that were bumped. Calendar-specific: compensates for the ±30-day
   * calendarView window.
   */
  async sweepStaleItems(bookId: string, items: TodoItemWithId[]): Promise<string[]> {
    const stale = items.filter(
      (item) =>
        item.id &&
        isNonTerminalStatus(item.status) &&
        computeBumpedDates(item.etsDateTime, item.etaDateTime) !== null,
    );
    if (stale.length === 0) return [];

    const bumped: string[] = [];
    const concurrency = 5;
    let index = 0;

    const worker = async (): Promise<void> => {
      while (true) {
        const i = index++;
        if (i >= stale.length) break;
        const item = stale[i];
        try {
          await this.updateItem(bookId, item.id, {});
          bumped.push(item.id);
        } catch (error) {
          console.error(`Error bumping stale TODO ${item.id}:`, error);
        }
      }
    };

    const workers = Math.min(concurrency, stale.length);
    await Promise.all(Array.from({ length: workers }, () => worker()));
    return bumped;
  }

  /**
   * Look up the display name of a book without listing them all.
   * Useful when only the bookId is in the URL and we want to render the name.
   */
  async getBookDisplayName(bookId: string): Promise<string | null> {
    const calendarId = unwrap(bookId);
    const client = await this.client();
    try {
      const calendar: Calendar = await client.api(`/me/calendars/${calendarId}`).get();
      return getCalendarDisplayName(calendar);
    } catch {
      return null;
    }
  }
}

/* ---- Helpers ---- */

function unwrap(bookId: string): string {
  // Strip the 'cal:' prefix; tolerate already-unprefixed inputs for backward compat.
  return bookId.startsWith('cal:') ? bookId.slice(4) : bookId;
}

function stripHtmlTags(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || div.innerText || '';
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildBodyHtml(stored: StoredTodoBody): string {
  const json = JSON.stringify(stored, null, 2);
  return `<pre>${ARRANGE_DATA_START_MARKER}\n${escapeHtml(json)}\n${ARRANGE_DATA_END_MARKER}</pre>`;
}

function extractBodyText(body: { contentType?: string; content?: string }): string {
  if (!body?.content) return '';
  return body.contentType === 'html' ? stripHtmlTags(body.content) : body.content;
}

function parseStoredBody(body: { contentType?: string; content?: string }): Partial<StoredTodoBody> | null {
  const content = extractBodyText(body);
  const startIndex = content.indexOf(ARRANGE_DATA_START_MARKER);
  const endIndex = content.indexOf(ARRANGE_DATA_END_MARKER);
  if (startIndex === -1 || endIndex === -1) return null;
  try {
    const jsonContent = content
      .substring(startIndex + ARRANGE_DATA_START_MARKER.length, endIndex)
      .trim();
    return JSON.parse(jsonContent);
  } catch (error) {
    console.error('Error parsing stored TODO body:', error);
    return null;
  }
}

function eventToTodoItem(event: CalendarEvent): TodoItemWithId | null {
  if (!event.id) return null;
  const item: TodoItemWithId = {
    id: event.id,
    subject: event.subject || '',
    categories: event.categories || [],
    etsDateTime: convertGraphDateTimeToISO(event.start),
    etaDateTime: convertGraphDateTimeToISO(event.end),
  };

  if (event.body?.content) {
    const stored = parseStoredBody(event.body);
    if (stored) {
      item.status = stored.status as TodoItem['status'];
      item.urgent = stored.urgent;
      item.important = stored.important;
      item.checklist = stored.checklist;
      item.remarks = stored.remarks;
      item.startDateTime = stored.startDateTime ?? undefined;
      item.finishDateTime = stored.finishDateTime ?? undefined;
      item.originalEtsDateTime = stored.originalEtsDateTime ?? null;
      item.originalEtaDateTime = stored.originalEtaDateTime ?? null;
    }
  }

  return item;
}
