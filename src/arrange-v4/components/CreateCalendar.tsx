'use client';

import { useState } from 'react';

interface CreateCalendarProps {
  onCreateCalendar: (name: string) => Promise<void>;
  disabled?: boolean;
}

export default function CreateCalendar({ onCreateCalendar, disabled = false }: CreateCalendarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [calendarName, setCalendarName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!calendarName.trim()) {
      setError('Calendar name is required');
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      // Automatically append " by arrange" if not already present
      const finalName = calendarName.toLowerCase().endsWith(' by arrange')
        ? calendarName
        : `${calendarName} by arrange`;
      
      await onCreateCalendar(finalName);
      
      // Reset form and close modal on success
      setCalendarName('');
      setIsOpen(false);
    } catch (err: any) {
      setError(err.message || 'Failed to create calendar');
    } finally {
      setIsCreating(false);
    }
  };

  const handleCancel = () => {
    setIsOpen(false);
    setCalendarName('');
    setError(null);
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        disabled={disabled}
        className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-6 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        Create Calendar
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h2 className="text-2xl font-bold mb-4">Create New Calendar</h2>
            
            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label htmlFor="calendarName" className="block text-sm font-medium text-gray-700 mb-2">
                  Calendar Name
                </label>
                <input
                  type="text"
                  id="calendarName"
                  value={calendarName}
                  onChange={(e) => setCalendarName(e.target.value)}
                  placeholder="My Calendar"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isCreating}
                  autoFocus
                />
                <p className="text-xs text-gray-500 mt-1">
                  " by arrange" will be automatically added to the end
                </p>
              </div>

              {error && (
                <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={isCreating}
                  className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating || !calendarName.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isCreating ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
