/**
 * Graph API response shapes used by the calendar backend.
 * Kept narrow — only the fields the store actually reads.
 */

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
