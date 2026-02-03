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
 * Converts a Graph API datetime object to ISO string
 * The Graph API returns datetime in a specific timezone, we need to convert it properly
 */
export function convertGraphDateTimeToISO(dateTimeObj?: { dateTime: string; timeZone: string }): string | undefined {
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
 * Fetches events from a calendar within a given time range
 * Handles pagination to fetch all events
 */
export async function getCalendarEvents(
  accessToken: string,
  calendarId: string,
  startDateTime: string,
  endDateTime: string
): Promise<CalendarEvent[]> {
  const client = createGraphClient(accessToken);
  const allEvents: CalendarEvent[] = [];

  try {
    let response = await client
      .api(`/me/calendars/${calendarId}/calendarView`)
      .query({
        startDateTime,
        endDateTime,
      })
      .top(100)
      .select('id,createdDateTime,lastModifiedDateTime,categories,subject,body,start,end')
      .get();
    
    allEvents.push(...(response.value || []));

    // Handle pagination
    while (response['@odata.nextLink']) {
      response = await client.api(response['@odata.nextLink']).get();
      allEvents.push(...(response.value || []));
    }

    return allEvents;
  } catch (error) {
    console.error('Error fetching calendar events:', error);
    throw error;
  }
}
