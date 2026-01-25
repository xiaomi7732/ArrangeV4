import { createGraphClient, CalendarEvent } from './graphService';

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
 * TODO Item interface based on the spec
 */
export interface TodoItem {
  subject: string;
  categories?: string[];
  etsDateTime?: string; // Estimated start time - maps to event start
  etaDateTime?: string; // Estimated end time - maps to event end
  urgent?: boolean;
  important?: boolean;
  status?: TodoStatus;
  checklist?: string[];
  remarks?: {
    type: 'text' | 'markdown';
    content: string;
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
  };

  const bodyContent = `${ARRANGE_DATA_START_MARKER}
${JSON.stringify(todoBodyData)}
${ARRANGE_DATA_END_MARKER}`;

  // Default to 1 hour from now if no times specified
  const now = new Date();
  const startTime = todoItem.etsDateTime ? new Date(todoItem.etsDateTime) : new Date(now.getTime() + 60 * 60 * 1000);
  const endTime = todoItem.etaDateTime ? new Date(todoItem.etaDateTime) : new Date(startTime.getTime() + 30 * 60 * 1000);

  const event = {
    subject: todoItem.subject,
    body: {
      contentType: 'text',
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
 * Converts a Graph API datetime object to ISO string
 * The Graph API returns datetime in a specific timezone, we need to convert it properly
 */
function convertGraphDateTimeToISO(dateTimeObj?: { dateTime: string; timeZone: string }): string | undefined {
  if (!dateTimeObj?.dateTime) return undefined;
  
  // If timezone is UTC, append 'Z'
  if (dateTimeObj.timeZone === 'UTC') {
    return `${dateTimeObj.dateTime}Z`;
  }
  
  // For other timezones, we need to handle them properly
  // The dateTime string from Graph API is in the specified timezone
  // We'll treat it as a local time string and create a Date object
  // Note: This is a simplified approach. For production, consider using a library like date-fns-tz
  try {
    const date = new Date(dateTimeObj.dateTime);
    // If the parsing succeeded, return ISO string
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  } catch (error) {
    console.error('Error parsing datetime:', error);
  }
  
  return undefined;
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
    const startIndex = event.body.content.indexOf(ARRANGE_DATA_START_MARKER);
    const endIndex = event.body.content.indexOf(ARRANGE_DATA_END_MARKER);
    
    if (startIndex !== -1 && endIndex !== -1) {
      try {
        const jsonContent = event.body.content.substring(startIndex + ARRANGE_DATA_START_MARKER.length, endIndex).trim();
        const todoData = JSON.parse(jsonContent);
        todoItem.status = todoData.status;
        todoItem.urgent = todoData.urgent;
        todoItem.important = todoData.important;
        todoItem.checklist = todoData.checklist;
        todoItem.remarks = todoData.remarks;
      } catch (error) {
        console.error('Error parsing TODO data:', error);
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
    const startIndex = existingEvent.body.content.indexOf(ARRANGE_DATA_START_MARKER);
    const endIndex = existingEvent.body.content.indexOf(ARRANGE_DATA_END_MARKER);
    
    if (startIndex !== -1 && endIndex !== -1) {
      try {
        const jsonContent = existingEvent.body.content.substring(startIndex + ARRANGE_DATA_START_MARKER.length, endIndex).trim();
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
  if (todoItem.status === 'inProgress' && !existingTodoData.startDateTime) {
    updatedTodoData.startDateTime = new Date().toISOString();
  }
  if (todoItem.status === 'finished' && !existingTodoData.finishDateTime) {
    updatedTodoData.finishDateTime = new Date().toISOString();
  }

  const bodyContent = `${ARRANGE_DATA_START_MARKER}
${JSON.stringify(updatedTodoData)}
${ARRANGE_DATA_END_MARKER}`;

  const updateData: any = {
    body: {
      contentType: 'text',
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
