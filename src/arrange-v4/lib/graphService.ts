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
