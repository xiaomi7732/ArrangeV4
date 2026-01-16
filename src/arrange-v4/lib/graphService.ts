import { Client } from '@microsoft/microsoft-graph-client';
import { AccountInfo } from '@azure/msal-browser';

export interface Calendar {
  id?: string;
  name?: string;
  color?: string;
  canEdit?: boolean;
  canShare?: boolean;
  canViewPrivateItems?: boolean;
  owner?: {
    name?: string;
    address?: string;
  };
}

/**
 * Creates an authenticated Microsoft Graph client
 */
export function createGraphClient(accessToken: string): Client {
  return Client.init({
    authProvider: (done) => {
      done(null, accessToken);
    },
  });
}

/**
 * Fetches all calendars for the authenticated user
 */
export async function getCalendars(accessToken: string): Promise<Calendar[]> {
  const client = createGraphClient(accessToken);
  
  try {
    const response = await client.api('/me/calendars').get();
    return response.value || [];
  } catch (error) {
    console.error('Error fetching calendars:', error);
    throw error;
  }
}

/**
 * Creates a new calendar for the authenticated user
 */
export async function createCalendar(accessToken: string, name: string): Promise<Calendar> {
  const client = createGraphClient(accessToken);
  
  try {
    const calendar = {
      name: name
    };
    
    const response = await client.api('/me/calendars').post(calendar);
    return response;
  } catch (error) {
    console.error('Error creating calendar:', error);
    throw error;
  }
}

/**
 * Deletes a calendar by ID
 */
export async function deleteCalendar(accessToken: string, calendarId: string): Promise<void> {
  const client = createGraphClient(accessToken);
  
  try {
    await client.api(`/me/calendars/${calendarId}`).delete();
  } catch (error) {
    console.error('Error deleting calendar:', error);
    throw error;
  }
}

/**
 * Fetches user information
 */
export async function getUserInfo(accessToken: string) {
  const client = createGraphClient(accessToken);
  
  try {
    const user = await client.api('/me').get();
    return user;
  } catch (error) {
    console.error('Error fetching user info:', error);
    throw error;
  }
}

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
 * Event response from Graph API
 */
export interface CalendarEvent {
  id?: string;
  subject?: string;
  body?: {
    contentType: string;
    content: string;
  };
  start?: {
    dateTime: string;
    timeZone: string;
  };
  end?: {
    dateTime: string;
    timeZone: string;
  };
  categories?: string[];
  createdDateTime?: string;
  lastModifiedDateTime?: string;
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
  const todoBodyData = {
    status: todoItem.status || 'new',
    urgent: todoItem.urgent || false,
    important: todoItem.important || false,
    checklist: todoItem.checklist || [],
    remarks: todoItem.remarks || null,
    startDateTime: null, // Set when status changes to inProgress
    finishDateTime: null, // Set when status changes to finished
  };

  const bodyContent = `<div data-todo="${encodeURIComponent(JSON.stringify(todoBodyData))}"></div>`;

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
 * Fetches events (TODO items) from a calendar within a given time range
 */
export async function getCalendarEvents(
  accessToken: string,
  calendarId: string,
  startDateTime: string,
  endDateTime: string
): Promise<CalendarEvent[]> {
  const client = createGraphClient(accessToken);

  try {
    const response = await client
      .api(`/me/calendars/${calendarId}/calendarView`)
      .query({
        startDateTime,
        endDateTime,
      })
      .select('id,createdDateTime,lastModifiedDateTime,categories,subject,body,start,end')
      .get();
    return response.value || [];
  } catch (error) {
    console.error('Error fetching calendar events:', error);
    throw error;
  }
}
