import { createGraphClient, CalendarEvent, convertGraphDateTimeToISO } from './graphService';

/**
 * Constants for TODO data markers
 */
const ARRANGE_DATA_START_MARKER = '====ArrangeDataStart====';
const ARRANGE_DATA_END_MARKER = '====ArrangeDataEnd====';

/**
 * TODO Item status values
 */
export type TodoStatus = 'new' | 'inProgress' | 'blocked' | 'finished' | 'cancelled';

/**
 * All possible status values
 */
export const ALL_STATUSES: TodoStatus[] = ['new', 'inProgress', 'blocked', 'finished', 'cancelled'];

/**
 * Human-readable labels for each status
 */
export const STATUS_LABELS: Record<TodoStatus, string> = {
  new: 'New',
  inProgress: 'In Progress',
  blocked: 'Blocked',
  finished: 'Finished',
  cancelled: 'Cancelled',
};

/**
 * TODO Item interface based on the spec
 */
export interface TodoItem {
  subject: string;
  categories?: string[];
  etsDateTime?: string; // ETS: Estimated Time to Start - the planned/scheduled start time (calendar event start)
  etaDateTime?: string; // ETA: Estimated Time of Accomplishment - the planned/scheduled end time (calendar event end)
  urgent?: boolean;
  important?: boolean;
  status?: TodoStatus;
  startDateTime?: string; // Actual start time - set when status changes to 'inProgress'
  finishDateTime?: string; // Actual finish time - set when status changes to 'finished'
  originalEtsDateTime?: string | null; // Original planned start time, preserved when dates are bumped forward
  originalEtaDateTime?: string | null; // Original planned end time, preserved when dates are bumped forward
  checklist?: string[];
  remarks?: {
    type: 'text' | 'markdown';
    content: string;
  } | null;
}

const NON_TERMINAL_STATUSES: TodoStatus[] = ['new', 'inProgress', 'blocked'];

export function isNonTerminalStatus(status: TodoStatus | undefined): boolean {
  return NON_TERMINAL_STATUSES.includes(status || 'new');
}

/**
 * Computes bumped dates for a stale TODO item.
 * Moves the date to today while preserving the original time-of-day and duration.
 * Returns null if no bump is needed (dates are already today or in the future).
 */
export function computeBumpedDates(
  etsDateTime: string | undefined,
  etaDateTime: string | undefined,
  now: Date = new Date()
): { etsDateTime: string; etaDateTime: string } | null {
  if (!etsDateTime || !etaDateTime) return null;

  const ets = new Date(etsDateTime);
  const eta = new Date(etaDateTime);

  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);

  // No bump needed if the event start is today or in the future
  if (ets >= todayStart) return null;

  const duration = eta.getTime() - ets.getTime();

  // Move to today, preserving the original time-of-day (UTC)
  const bumpedEts = new Date(todayStart);
  bumpedEts.setUTCHours(ets.getUTCHours(), ets.getUTCMinutes(), ets.getUTCSeconds(), ets.getUTCMilliseconds());

  const bumpedEta = new Date(bumpedEts.getTime() + duration);

  return {
    etsDateTime: bumpedEts.toISOString(),
    etaDateTime: bumpedEta.toISOString(),
  };
}

/**
 * Creates a TODO item as an event in the specified calendar
 * Based on TODO Item Spec - stores custom fields in body JSON
 */
export async function createTodoItem(
  accessToken: string,
  calendarId: string,
  todoItem: TodoItem
): Promise<CalendarEvent> {
  const client = createGraphClient(accessToken);

  // Build body content with TODO-specific data stored as JSON
  const status = todoItem.status || 'new';
  const todoBodyData = {
    status: status,
    urgent: todoItem.urgent || false,
    important: todoItem.important || false,
    checklist: todoItem.checklist || [],
    remarks: todoItem.remarks || null,
    startDateTime: status === 'inProgress' ? new Date().toISOString() : null, // Set when status is inProgress
    finishDateTime: null, // Set when status changes to finished
    originalEtsDateTime: null,
    originalEtaDateTime: null,
  };

  const bodyContent = buildBodyHtml(todoBodyData);

  // Default to 1 hour from now if no times specified
  const now = new Date();
  const startTime = todoItem.etsDateTime ? new Date(todoItem.etsDateTime) : new Date(now.getTime() + 60 * 60 * 1000);
  const endTime = todoItem.etaDateTime ? new Date(todoItem.etaDateTime) : new Date(startTime.getTime() + 30 * 60 * 1000);

  const event = {
    subject: todoItem.subject,
    body: {
      contentType: 'html',
      content: bodyContent,
    },
    start: {
      dateTime: startTime.toISOString(),
      timeZone: 'UTC',
    },
    end: {
      dateTime: endTime.toISOString(),
      timeZone: 'UTC',
    },
    categories: todoItem.categories || [],
    reminderMinutesBeforeStart: 0,
    isReminderOn: false,
  };

  try {
    const response = await client.api(`/me/calendars/${calendarId}/events`).post(event);
    return response;
  } catch (error) {
    console.error('Error creating TODO item:', error);
    throw error;
  }
}

/**
 * Strips HTML tags and extracts plain text (used for backward compat with old plain-text bodies)
 */
function stripHtmlTags(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || div.innerText || '';
}

/**
 * Builds the HTML body content for a calendar event, wrapping the TODO JSON data
 * in a <pre> tag between markers for easy extraction and human-readable display.
 */
function buildBodyHtml(todoData: object): string {
  const json = JSON.stringify(todoData, null, 2);
  return `<pre>${ARRANGE_DATA_START_MARKER}\n${json}\n${ARRANGE_DATA_END_MARKER}</pre>`;
}

/**
 * Extracts the raw text content from an event body, handling both HTML and plain text.
 */
function extractBodyText(body: { contentType?: string; content?: string }): string {
  if (!body?.content) return '';

  let content = body.content;
  if (body.contentType === 'html') {
    content = stripHtmlTags(content);
  }
  return content;
}

/**
 * Parses TODO-specific data from an event body
 */
export function parseTodoData(event: CalendarEvent): TodoItem & { id?: string } {
  const todoItem: TodoItem & { id?: string } = {
    id: event.id,
    subject: event.subject || '',
    categories: event.categories || [],
    etsDateTime: convertGraphDateTimeToISO(event.start),
    etaDateTime: convertGraphDateTimeToISO(event.end),
  };

  // Extract TODO data from body if present
  if (event.body?.content) {
    const content = extractBodyText(event.body);
    
    const startIndex = content.indexOf(ARRANGE_DATA_START_MARKER);
    const endIndex = content.indexOf(ARRANGE_DATA_END_MARKER);
    
    if (startIndex !== -1 && endIndex !== -1) {
      try {
        const jsonContent = content.substring(startIndex + ARRANGE_DATA_START_MARKER.length, endIndex).trim();
        const todoData = JSON.parse(jsonContent);
        todoItem.status = todoData.status;
        todoItem.urgent = todoData.urgent;
        todoItem.important = todoData.important;
        todoItem.checklist = todoData.checklist;
        todoItem.remarks = todoData.remarks;
        todoItem.startDateTime = todoData.startDateTime;
        todoItem.finishDateTime = todoData.finishDateTime;
        todoItem.originalEtsDateTime = todoData.originalEtsDateTime || null;
        todoItem.originalEtaDateTime = todoData.originalEtaDateTime || null;
      } catch (error) {
        console.error('Error parsing TODO data:', error);
        console.error('Failed JSON content:', content.substring(startIndex, endIndex + ARRANGE_DATA_END_MARKER.length));
      }
    }
  }

  return todoItem;
}

/**
 * Updates a TODO item (event) in the specified calendar
 */
export async function updateTodoItem(
  accessToken: string,
  calendarId: string,
  eventId: string,
  todoItem: Partial<TodoItem>
): Promise<CalendarEvent> {
  const client = createGraphClient(accessToken);

  // Fetch existing event first to preserve data
  const existingEvent = await client
    .api(`/me/calendars/${calendarId}/events/${eventId}`)
    .get();

  // Parse existing TODO data
  let existingTodoData: any = {
    status: 'new',
    urgent: false,
    important: false,
    checklist: [],
    remarks: null,
    startDateTime: null,
    finishDateTime: null,
  };

  if (existingEvent.body?.content) {
    const content = extractBodyText(existingEvent.body);
    
    const startIndex = content.indexOf(ARRANGE_DATA_START_MARKER);
    const endIndex = content.indexOf(ARRANGE_DATA_END_MARKER);
    
    if (startIndex !== -1 && endIndex !== -1) {
      try {
        const jsonContent = content.substring(startIndex + ARRANGE_DATA_START_MARKER.length, endIndex).trim();
        existingTodoData = JSON.parse(jsonContent);
      } catch (error) {
        console.error('Error parsing existing TODO data:', error);
      }
    }
  }

  // Merge updates
  const updatedTodoData = {
    ...existingTodoData,
    status: todoItem.status !== undefined ? todoItem.status : existingTodoData.status,
    urgent: todoItem.urgent !== undefined ? todoItem.urgent : existingTodoData.urgent,
    important: todoItem.important !== undefined ? todoItem.important : existingTodoData.important,
    checklist: todoItem.checklist !== undefined ? todoItem.checklist : existingTodoData.checklist,
    remarks: todoItem.remarks !== undefined ? todoItem.remarks : existingTodoData.remarks,
  };

  // Update timestamps based on status changes
  if (todoItem.status !== undefined) {
    // Set startDateTime when status changes to inProgress
    if (todoItem.status === 'inProgress' && !existingTodoData.startDateTime) {
      updatedTodoData.startDateTime = new Date().toISOString();
    }
    // Remove startDateTime when status changes to new
    if (todoItem.status === 'new') {
      updatedTodoData.startDateTime = null;
    }
    // Set finishDateTime when status changes to finished
    if (todoItem.status === 'finished') {
      const now = new Date().toISOString();
      // Also set startDateTime if not already set (for direct new → finished transitions)
      if (!existingTodoData.startDateTime) {
        updatedTodoData.startDateTime = now;
      }
      if (!existingTodoData.finishDateTime) {
        updatedTodoData.finishDateTime = now;
      }
    }
    // Remove finishDateTime when status changes from finished to anything else
    if (todoItem.status !== 'finished' && existingTodoData.status === 'finished') {
      updatedTodoData.finishDateTime = null;
    }
  }

  // Date-bump logic: move stale non-terminal items to today
  const effectiveStatus = updatedTodoData.status || 'new';
  const callerSetDates = todoItem.etsDateTime !== undefined || todoItem.etaDateTime !== undefined;

  if (isNonTerminalStatus(effectiveStatus) && !callerSetDates) {
    const currentEts = convertGraphDateTimeToISO(existingEvent.start);
    const currentEta = convertGraphDateTimeToISO(existingEvent.end);
    const bumped = computeBumpedDates(currentEts, currentEta);

    if (bumped) {
      // Preserve original planned dates (only on first bump)
      if (!updatedTodoData.originalEtsDateTime) {
        updatedTodoData.originalEtsDateTime = currentEts;
      }
      if (!updatedTodoData.originalEtaDateTime) {
        updatedTodoData.originalEtaDateTime = currentEta;
      }

      todoItem = {
        ...todoItem,
        etsDateTime: bumped.etsDateTime,
        etaDateTime: bumped.etaDateTime,
      };
    }
  }

  const bodyContent = buildBodyHtml(updatedTodoData);

  const updateData: any = {
    body: {
      contentType: 'html',
      content: bodyContent,
    },
  };

  if (todoItem.subject !== undefined) {
    updateData.subject = todoItem.subject;
  }
  if (todoItem.categories !== undefined) {
    updateData.categories = todoItem.categories;
  }
  if (todoItem.etsDateTime !== undefined) {
    updateData.start = {
      dateTime: new Date(todoItem.etsDateTime).toISOString(),
      timeZone: 'UTC',
    };
  }
  if (todoItem.etaDateTime !== undefined) {
    updateData.end = {
      dateTime: new Date(todoItem.etaDateTime).toISOString(),
      timeZone: 'UTC',
    };
  }

  try {
    const response = await client
      .api(`/me/calendars/${calendarId}/events/${eventId}`)
      .patch(updateData);
    return response;
  } catch (error) {
    console.error('Error updating TODO item:', error);
    throw error;
  }
}

/**
 * Sweeps stale non-terminal TODO items by bumping their calendar dates forward.
 * Returns the IDs of items that were bumped so the caller can refresh.
 */
export async function sweepStaleTodos(
  accessToken: string,
  calendarId: string,
  todoItems: (TodoItem & { id?: string })[]
): Promise<string[]> {
  const staleItems = todoItems.filter(item =>
    item.id &&
    isNonTerminalStatus(item.status) &&
    computeBumpedDates(item.etsDateTime, item.etaDateTime) !== null
  );

  if (staleItems.length === 0) return [];

  const bumpedIds: string[] = [];
  for (const item of staleItems) {
    try {
      // An empty update triggers the built-in date-bump logic in updateTodoItem
      await updateTodoItem(accessToken, calendarId, item.id!, {});
      bumpedIds.push(item.id!);
    } catch (error) {
      console.error(`Error bumping stale TODO ${item.id}:`, error);
    }
  }

  return bumpedIds;
}

/**
 * Deletes a TODO item (event) from the specified calendar
 */
export async function deleteTodoItem(
  accessToken: string,
  calendarId: string,
  eventId: string
): Promise<void> {
  const client = createGraphClient(accessToken);

  try {
    await client.api(`/me/calendars/${calendarId}/events/${eventId}`).delete();
  } catch (error) {
    console.error('Error deleting TODO item:', error);
    throw error;
  }
}
