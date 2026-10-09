import { Client } from '@microsoft/microsoft-graph-client';
import { createGraphClient } from '@/lib/graphService';
import type {
  Book,
  CreateBookOptions,
  ItemUpdate,
  CreateItemOptions,
  ListItemsOptions,
  StoreOperationOptions,
  StoreOptions,
  TodoItem,
  TodoItemWithId,
  TodoStore,
} from '../types';
import { isNonTerminalStatus } from '../types';
import type { Calendar, CalendarEvent } from './types';
import { ARRANGE_SUFFIX, ARRANGE_SUFFIX_REGEX, calendarToBook, convertGraphDateTimeToISO, filterArrangeCalendars, getCalendarDisplayName } from './utils';
import { computeWindowAnchor, isWindowAnchorStale, anchorZoneRanges } from './windowAnchor';
import { resolveIncomingDates, resolveItemDates, resolveStoredDates } from './itemDates';
import {
  parseArrangeBody,
  serializeArrangeBody,
  type ArrangePayloadResult,
} from './body';
import { TokenAcquisitionCoordinator } from '../tokenAcquisition';
import type { StoredTodoBody } from './storedFields';
import { describeStoredFieldDamage } from './storedFields';

const itemUpdateQueues = new Map<string, Promise<void>>();
const itemUpdateWaiters: Array<() => void> = [];
let activeItemUpdates = 0;
const MAX_CONCURRENT_ITEM_UPDATES = 5;

async function acquireItemUpdateSlot(): Promise<void> {
  if (activeItemUpdates < MAX_CONCURRENT_ITEM_UPDATES) {
    activeItemUpdates += 1;
    return;
  }
  await new Promise<void>(resolve => itemUpdateWaiters.push(resolve));
}

function releaseItemUpdateSlot(): void {
  const next = itemUpdateWaiters.shift();
  if (next) {
    next();
    return;
  }
  activeItemUpdates -= 1;
}


/**
 * Implements TodoStore against the Microsoft Graph Calendar API.
 *
 * Each book is an Outlook calendar whose name ends with " by arrange".
 * Each item is a calendar event whose body holds a JSON blob between
 * `====ArrangeDataStart====` / `====ArrangeDataEnd====` markers.
 */
export class CalendarStore implements TodoStore {
  private readonly tokenAcquisition: TokenAcquisitionCoordinator;

  constructor(opts: StoreOptions) {
    this.tokenAcquisition = new TokenAcquisitionCoordinator(opts.acquireToken);
  }

  private async client(options?: StoreOperationOptions): Promise<Client> {
    const token = await this.tokenAcquisition.getToken(options);
    return createGraphClient(token);
  }

  /* ---- Books ---- */

  async listBooks(options?: StoreOperationOptions): Promise<Book[]> {
    const client = await this.client(options);
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
    const client = await this.client(opts);

    const events: CalendarEvent[] = [];

    if (opts.range === 'window') {
      if (!opts.fromDate || !opts.toDate) {
        throw new Error("listItems with range='window' requires fromDate and toDate.");
      }
      // Graph matches on the event, which is only the window anchor. A task
      // planned outside the requested period can therefore be anchored inside
      // it and vice versa, so the anchor zone is always fetched too and the
      // caller filters on the planned dates it gets back.
      for (const range of anchorZoneRanges(opts.fromDate, opts.toDate)) {
        let response = await client
          .api(`/me/calendars/${calendarId}/calendarView`)
          .query({ startDateTime: range.fromDate, endDateTime: range.toDate })
          .top(100)
          .select('id,webLink,createdDateTime,lastModifiedDateTime,categories,subject,body,start,end')
          .get();
        events.push(...(response.value || []));
        while (response['@odata.nextLink']) {
          response = await client.api(response['@odata.nextLink']).get();
          events.push(...(response.value || []));
        }
      }
    } else {
      // 'all'
      let response = await client
        .api(`/me/calendars/${calendarId}/events`)
        .top(100)
        .select('id,webLink,createdDateTime,lastModifiedDateTime,categories,subject,body,start,end')
        .get();
      events.push(...(response.value || []));
      while (response['@odata.nextLink']) {
        response = await client.api(response['@odata.nextLink']).get();
        events.push(...(response.value || []));
      }
    }

    const seenIds = new Set<string | undefined>();
    return events
      .filter(event => {
        if (seenIds.has(event.id)) return false;
        seenIds.add(event.id);
        return true;
      })
      .map(eventToTodoItem)
      .filter((i): i is TodoItemWithId => i !== null);
  }

  async createItem(
    bookId: string,
    item: TodoItem,
    options: CreateItemOptions = {},
  ): Promise<TodoItemWithId> {
    const calendarId = unwrap(bookId);
    const client = await this.client();

    const status = item.status || 'new';
    // A copy keeps the gaps the original had: stamping "started now" on an item
    // that was moved between books would invent history.
    const lifecycleDefault = options.asCopy ? null : new Date().toISOString();
    const now = new Date();
    const incoming = resolveIncomingDates(item);
    const start = incoming.etsDateTime ? new Date(incoming.etsDateTime) : new Date(now.getTime() + 60 * 60 * 1000);
    const end = incoming.etaDateTime ? new Date(incoming.etaDateTime) : new Date(start.getTime() + 30 * 60 * 1000);
    const stored: StoredTodoBody = {
      status,
      urgent: item.urgent || false,
      important: item.important || false,
      checklist: item.checklist || [],
      remarks: item.remarks || null,
      startDateTime: item.startDateTime
        ?? (status === 'inProgress' || status === 'finished' ? lifecycleDefault : null),
      finishDateTime: item.finishDateTime
        ?? (status === 'finished' ? lifecycleDefault : null),
      // The dates the user planned. The event's own start/end is only the
      // window anchor and may sit elsewhere, so it cannot carry these.
      etsDateTime: start.toISOString(),
      etaDateTime: end.toISOString(),
      // Filled in below, once the anchor is known.
      anchorStartDateTime: null,
      anchorEndDateTime: null,
      // A legacy item's pre-bump dates were folded into the planned dates
      // above by resolveIncomingDates, so nothing is left to carry over.
      originalEtsDateTime: null,
      originalEtaDateTime: null,
      matrixOrder: item.matrixOrder,
      scrumOrder: item.scrumOrder,
    };

    // Anchoring keeps a stale item inside the ±30-day calendarView window
    // without touching the planned dates above.
    const anchor = isNonTerminalStatus(status)
      ? computeWindowAnchor(stored.etsDateTime, stored.etaDateTime, now)
      : null;
    const anchorStart = anchor?.start ?? start.toISOString();
    const anchorEnd = anchor?.end ?? end.toISOString();
    stored.anchorStartDateTime = anchorStart;
    stored.anchorEndDateTime = anchorEnd;

    const event = {
      subject: item.subject,
      body: { contentType: 'html', content: buildBodyHtml(stored) },
      start: { dateTime: anchorStart, timeZone: 'UTC' },
      end: { dateTime: anchorEnd, timeZone: 'UTC' },
      categories: item.categories || [],
      reminderMinutesBeforeStart: 0,
      isReminderOn: false,
    };

    const created: CalendarEvent = await client.api(`/me/calendars/${calendarId}/events`).post(event);
    const parsed = eventToTodoItem(created);
    if (!parsed) throw new Error('Created event returned no ID.');
    return parsed;
  }

  async updateItem(
    bookId: string,
    itemId: string,
    updates: Partial<TodoItem>,
    options?: StoreOperationOptions,
  ): Promise<TodoItemWithId> {
    const calendarId = unwrap(bookId);
    const queueKey = `${calendarId}:${itemId}`;
    const previous = itemUpdateQueues.get(queueKey) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const queued = previous.then(() => gate, () => gate);
    itemUpdateQueues.set(queueKey, queued);

    await previous.catch(() => undefined);
    await acquireItemUpdateSlot();
    try {
      return await this.updateItemCore(calendarId, itemId, updates, options);
    } finally {
      releaseItemUpdateSlot();
      release();
      if (itemUpdateQueues.get(queueKey) === queued) {
        itemUpdateQueues.delete(queueKey);
      }
    }
  }

  async updateItems(
    bookId: string,
    updates: ItemUpdate[],
    options?: StoreOperationOptions,
  ): Promise<TodoItemWithId[]> {
    const results = await Promise.allSettled(
      updates.map(update => this.updateItem(
        bookId,
        update.itemId,
        update.updates,
        options,
      )),
    );
    const failure = results.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    return results.map(result => {
      if (result.status === 'rejected') throw result.reason;
      return result.value;
    });
  }

  private async updateItemCore(
    calendarId: string,
    itemId: string,
    updates: Partial<TodoItem>,
    options?: StoreOperationOptions,
  ): Promise<TodoItemWithId> {
    const client = await this.client(options);

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
      etsDateTime: null,
      etaDateTime: null,
      anchorStartDateTime: null,
      anchorEndDateTime: null,
      originalEtsDateTime: null,
      originalEtaDateTime: null,
      matrixOrder: undefined,
      scrumOrder: undefined,
    };
    if (existingEvent.body?.content) {
      const parsed = parseStoredBody(existingEvent.body);
      if (parsed.status === 'corrupt') {
        // Refusing the write is the whole point: merging onto defaults would
        // persist them over the user's real status, flags, checklist and
        // remarks, turning a recoverable read problem into permanent loss.
        throw new Error(
          `This item's saved data could not be read (${parsed.reason}). `
          + 'Saving now would overwrite it, so the change was not applied. '
          + 'Open the event in Outlook to repair or clear its description, then retry.',
        );
      }
      if (parsed.status === 'ok') existingStored = { ...existingStored, ...parsed.data };
    }

    const merged: StoredTodoBody = {
      ...existingStored,
      status: updates.status !== undefined ? updates.status : existingStored.status,
      urgent: updates.urgent !== undefined ? updates.urgent : existingStored.urgent,
      important: updates.important !== undefined ? updates.important : existingStored.important,
      checklist: updates.checklist !== undefined ? updates.checklist : existingStored.checklist,
      remarks: updates.remarks !== undefined ? updates.remarks : existingStored.remarks,
      // Honor caller-provided values for the timestamp/original-date body fields.
      // The status-transition logic below may further adjust startDateTime /
      // finishDateTime when status changes, but only when the caller didn't set
      // them explicitly.
      startDateTime:
        updates.startDateTime !== undefined ? updates.startDateTime ?? null : existingStored.startDateTime,
      finishDateTime:
        updates.finishDateTime !== undefined ? updates.finishDateTime ?? null : existingStored.finishDateTime,
      // Legacy pre-bump dates: read above to recover the user's real dates,
      // then dropped so there is only one source for them.
      originalEtsDateTime: null,
      originalEtaDateTime: null,
      etsDateTime: existingStored.etsDateTime,
      etaDateTime: existingStored.etaDateTime,
      matrixOrder: updates.matrixOrder !== undefined ? updates.matrixOrder : existingStored.matrixOrder,
      scrumOrder: updates.scrumOrder !== undefined ? updates.scrumOrder : existingStored.scrumOrder,
    };

    // Timestamp transitions based on status changes — only fill in fields the
    // caller didn't explicitly set. Lets pages pass `{ status: 'inProgress' }`
    // and have the store derive startDateTime, while still allowing an explicit
    // override when needed.
    if (updates.status !== undefined) {
      if (updates.status === 'inProgress' && !existingStored.startDateTime && updates.startDateTime === undefined) {
        merged.startDateTime = new Date().toISOString();
      }
      if (updates.status === 'new' && updates.startDateTime === undefined) {
        merged.startDateTime = null;
      }
      if (updates.status === 'finished') {
        const now = new Date().toISOString();
        if (!existingStored.startDateTime && updates.startDateTime === undefined) merged.startDateTime = now;
        if (!existingStored.finishDateTime && updates.finishDateTime === undefined) merged.finishDateTime = now;
      }
      if (updates.status !== 'finished' && existingStored.status === 'finished' && updates.finishDateTime === undefined) {
        merged.finishDateTime = null;
      }
    }

    // Dates: the payload carries what the user planned; the event's start/end
    // is only the anchor that keeps a non-terminal item inside the ±30-day
    // calendarView window. Anchoring therefore never changes ETS/ETA, and
    // sweeping is invisible to the user.
    const effectiveStatus = (merged.status || 'new') as TodoItem['status'];
    const dates = resolveItemDates({
      storedEts: existingStored.etsDateTime,
      storedEta: existingStored.etaDateTime,
      storedAnchorStart: existingStored.anchorStartDateTime,
      storedAnchorEnd: existingStored.anchorEndDateTime,
      legacyOriginalEts: existingStored.originalEtsDateTime,
      legacyOriginalEta: existingStored.originalEtaDateTime,
      eventStart: convertGraphDateTimeToISO(existingEvent.start),
      eventEnd: convertGraphDateTimeToISO(existingEvent.end),
      updatedEts: updates.etsDateTime,
      updatedEta: updates.etaDateTime,
      status: effectiveStatus,
    });
    merged.etsDateTime = dates.etsDateTime;
    merged.etaDateTime = dates.etaDateTime;
    merged.anchorStartDateTime = dates.storedAnchorStart;
    merged.anchorEndDateTime = dates.storedAnchorEnd;

    const patch: Record<string, unknown> = {
      body: { contentType: 'html', content: buildBodyHtml(merged) },
    };
    if (updates.subject !== undefined) patch.subject = updates.subject;
    if (updates.categories !== undefined) patch.categories = updates.categories;
    if (dates.anchorStart !== undefined) {
      patch.start = { dateTime: dates.anchorStart, timeZone: 'UTC' };
    }
    if (dates.anchorEnd !== undefined) {
      patch.end = { dateTime: dates.anchorEnd, timeZone: 'UTC' };
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

  async deleteItems(bookId: string, itemIds: string[]): Promise<void> {
    let index = 0;
    let firstError: unknown;
    const worker = async () => {
      while (index < itemIds.length) {
        const itemId = itemIds[index++];
        try {
          await this.deleteItem(bookId, itemId);
        } catch (error) {
          firstError ??= error;
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(5, itemIds.length) }, () => worker()),
    );
    if (firstError) throw firstError;
  }

  /* ---- Calendar-specific: not on the TodoStore interface ---- */

  /**
   * Rolls the event anchor of stale non-terminal items forward to today so
   * they keep coming back from the ±30-day calendarView window. Returns the
   * IDs of the items whose anchor was moved. The items' ETS/ETA are not
   * touched, so this is invisible to the user. Calendar-specific: backends
   * that return every item have no window to compensate for.
   */
  async sweepStaleItems(
    bookId: string,
    items: TodoItemWithId[],
    options?: StoreOperationOptions,
  ): Promise<string[]> {
    const stale = items.filter(
      (item) =>
        item.id &&
        // A write to an unreadable item is refused, so sweeping it would fail
        // every time and keep the session sweep from ever being marked done.
        !item.dataUnreadable &&
        isNonTerminalStatus(item.status) &&
        // The item's own ETS may be long past on purpose; only the anchor
        // falling behind means the event needs moving.
        isWindowAnchorStale(item.windowAnchorDateTime) &&
        computeWindowAnchor(item.etsDateTime, item.etaDateTime) !== null,
    );
    if (stale.length === 0) return [];

    const bumped: string[] = [];
    const concurrency = 5;
    let index = 0;
    let firstError: unknown;

    const worker = async (): Promise<void> => {
      while (true) {
        const i = index++;
        if (i >= stale.length) break;
        const item = stale[i];
        try {
          await this.updateItem(bookId, item.id, {}, options);
          bumped.push(item.id);
        } catch (error) {
          firstError ??= error;
          console.error(`Error bumping stale TODO ${item.id}:`, error);
        }
      }
    };

    const workers = Math.min(concurrency, stale.length);
    await Promise.all(Array.from({ length: workers }, () => worker()));
    if (firstError) throw firstError;
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

function buildBodyHtml(stored: StoredTodoBody): string {
  return serializeArrangeBody(stored);
}

function extractBodyText(body: { contentType?: string; content?: string }): string {
  if (!body?.content) return '';
  return body.contentType === 'html' ? stripHtmlTags(body.content) : body.content;
}

function parseStoredBody(
  body: { contentType?: string; content?: string },
): ArrangePayloadResult<Partial<StoredTodoBody>> {
  if (!body?.content) return { status: 'absent' };
  const parsed = parseArrangeBody<Partial<StoredTodoBody>>(extractBodyText(body));
  if (parsed.status !== 'ok') return parsed;
  // Parsing only proves it was JSON. Accepting a payload whose fields are not
  // Arrange data would merge nonsense over whatever the event really held.
  const damage = describeStoredFieldDamage(parsed.data);
  return damage === null ? parsed : { status: 'corrupt', reason: damage };
}

function eventToTodoItem(event: CalendarEvent): TodoItemWithId | null {
  if (!event.id) return null;
  const eventStart = convertGraphDateTimeToISO(event.start);
  const eventEnd = convertGraphDateTimeToISO(event.end);
  const item: TodoItemWithId = {
    id: event.id,
    ...(event.webLink
      ? { source: { url: event.webLink, label: 'Open in Outlook Calendar' } }
      : {}),
    subject: event.subject || '',
    categories: event.categories || [],
    etsDateTime: eventStart,
    etaDateTime: eventEnd,
    ...(eventStart ? { windowAnchorDateTime: eventStart } : {}),
  };

  if (event.body?.content) {
    const parsed = parseStoredBody(event.body);
    if (parsed.status === 'corrupt') {
      // Surfaced as a warning rather than thrown: one damaged event must not
      // take down the whole board. Writes to this item are blocked separately
      // so the unreadable data is never overwritten with defaults.
      console.warn(
        `Arrange data for event ${event.id} could not be read (${parsed.reason}); `
        + 'showing the event without its saved fields.',
      );
      item.dataUnreadable = true;
    }
    if (parsed.status === 'ok') {
      const stored = parsed.data;
      item.status = stored.status as TodoItem['status'];
      item.urgent = stored.urgent;
      item.important = stored.important;
      item.checklist = stored.checklist;
      item.remarks = stored.remarks;
      item.startDateTime = stored.startDateTime ?? undefined;
      item.finishDateTime = stored.finishDateTime ?? undefined;
      // The event is only the anchor; the planned dates come from the payload,
      // falling back to a legacy item's pre-bump originals.
      const dates = resolveStoredDates({
        storedEts: stored.etsDateTime,
        storedEta: stored.etaDateTime,
        storedAnchorStart: stored.anchorStartDateTime,
        storedAnchorEnd: stored.anchorEndDateTime,
        legacyOriginalEts: stored.originalEtsDateTime,
        legacyOriginalEta: stored.originalEtaDateTime,
        eventStart,
        eventEnd,
      });
      item.etsDateTime = dates.etsDateTime ?? undefined;
      item.etaDateTime = dates.etaDateTime ?? undefined;
      item.originalEtsDateTime = null;
      item.originalEtaDateTime = null;
      if (typeof stored.matrixOrder === 'number' && Number.isFinite(stored.matrixOrder)) {
        item.matrixOrder = stored.matrixOrder;
      }
      if (typeof stored.scrumOrder === 'number' && Number.isFinite(stored.scrumOrder)) {
        item.scrumOrder = stored.scrumOrder;
      }
    }
  }

  return item;
}
