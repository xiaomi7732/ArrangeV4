import { Calendar } from './graphService';

const ARRANGE_SUFFIX_REGEX = / by arrange$/i;

export function isArrangeCalendar(calendar: Calendar): boolean {
  return ARRANGE_SUFFIX_REGEX.test(calendar.name || '');
}

export function filterArrangeCalendars(calendars: Calendar[]): Calendar[] {
  return calendars.filter(isArrangeCalendar);
}

export function getCalendarDisplayName(calendar: Calendar): string {
  return calendar.name?.replace(ARRANGE_SUFFIX_REGEX, '') || calendar.name || 'Untitled';
}
