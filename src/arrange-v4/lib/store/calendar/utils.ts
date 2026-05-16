import type { Book } from '../types';
import { makeBookId } from '../types';
import type { Calendar } from './types';

const ARRANGE_SUFFIX_REGEX = / by arrange$/i;
export { ARRANGE_SUFFIX_REGEX };

/** The suffix appended to a calendar name to mark it as an Arrange book. */
export const ARRANGE_SUFFIX = ' by arrange';

export function isArrangeCalendar(calendar: Calendar): boolean {
  return ARRANGE_SUFFIX_REGEX.test(calendar.name || '');
}

export function filterArrangeCalendars(calendars: Calendar[]): Calendar[] {
  return calendars.filter(isArrangeCalendar);
}

export function getCalendarDisplayName(calendar: Calendar): string {
  return calendar.name?.replace(ARRANGE_SUFFIX_REGEX, '') || calendar.name || 'Untitled';
}

/**
 * Converts a Graph Calendar resource into the abstract Book shape.
 */
export function calendarToBook(calendar: Calendar): Book | null {
  if (!calendar.id) return null;
  return {
    id: makeBookId('calendar', calendar.id),
    name: getCalendarDisplayName(calendar),
    backend: 'calendar',
    color: calendar.color,
    owner: calendar.owner,
    canEdit: calendar.canEdit,
    canShare: calendar.canShare,
    canViewPrivateItems: calendar.canViewPrivateItems,
  };
}

/**
 * Converts a Graph dateTime object to ISO string.
 * Calendar-specific because only the Graph Calendar response uses this shape.
 */
export function convertGraphDateTimeToISO(dateTimeObj?: { dateTime: string; timeZone: string }): string | undefined {
  if (!dateTimeObj?.dateTime) return undefined;

  if (dateTimeObj.timeZone === 'UTC') {
    return `${dateTimeObj.dateTime}Z`;
  }

  try {
    const date = new Date(dateTimeObj.dateTime);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  } catch (error) {
    console.error('Error parsing datetime:', error);
  }

  return undefined;
}
