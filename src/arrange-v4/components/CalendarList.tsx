'use client';

import { useState } from 'react';
import { Calendar } from '@/lib/graphService';

interface CalendarListProps {
  calendars: Calendar[];
  loading: boolean;
  error: string | null;
  onDeleteCalendar: (calendarId: string) => Promise<void>;
}

export default function CalendarList({ calendars, loading, error, onDeleteCalendar }: CalendarListProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (calendar: Calendar) => {
    if (!calendar.id) return;
    
    const displayName = calendar.name?.replace(/ by arrange$/i, '') || calendar.name || 'this calendar';
    if (!confirm(`Are you sure you want to delete "${displayName}"?`)) {
      return;
    }

    setDeletingId(calendar.id);
    try {
      await onDeleteCalendar(calendar.id);
    } catch (error) {
      console.error('Failed to delete calendar:', error);
      alert('Failed to delete calendar. Please try again.');
    } finally {
      setDeletingId(null);
    }
  };
  if (loading) {
    return (
      <div className="flex justify-center items-center p-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded relative" role="alert">
        <strong className="font-bold">Error: </strong>
        <span className="block sm:inline">{error}</span>
      </div>
    );
  }

  if (calendars.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No calendars ending with "by arrange" found.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold mb-4">Calendars by Arrange</h2>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {calendars.map((calendar) => (
          <div
            key={calendar.id}
            className="border rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow bg-white"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h3 className="font-semibold text-lg mb-2">
                  {calendar.name?.replace(/ by arrange$/i, '') || calendar.name}
                </h3>
                {calendar.owner && (
                  <p className="text-sm text-gray-600 mb-1">
                    Owner: {calendar.owner.name || calendar.owner.address}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 mt-2">
                  {calendar.canEdit && (
                    <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                      Can Edit
                    </span>
                  )}
                  {calendar.canShare && (
                    <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                      Can Share
                    </span>
                  )}
                  {calendar.canViewPrivateItems && (
                    <span className="text-xs bg-purple-100 text-purple-800 px-2 py-1 rounded">
                      View Private
                    </span>
                  )}
                </div>
              </div>
              {calendar.color && (
                <div
                  className="w-6 h-6 rounded-full ml-2 flex-shrink-0"
                  style={{ backgroundColor: calendar.color }}
                  title={`Color: ${calendar.color}`}
                />
              )}
            </div>
            {calendar.id && (
              <p className="text-xs text-gray-400 mt-3 font-mono truncate" title={calendar.id}>
                ID: {calendar.id}
              </p>
            )}
            <div className="mt-4 pt-3 border-t border-gray-200">
              <button
                onClick={() => handleDelete(calendar)}
                disabled={deletingId === calendar.id}
                className="w-full bg-red-50 hover:bg-red-100 text-red-700 font-medium py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
              >
                {deletingId === calendar.id ? 'Deleting...' : 'Delete Calendar'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
