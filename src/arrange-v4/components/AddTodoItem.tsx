'use client';

import { useState } from 'react';
import { TodoItem, TodoStatus } from '@/lib/todoDataService';

interface AddTodoItemProps {
  onAddTodo: (todoItem: TodoItem) => Promise<void>;
  disabled?: boolean;
}

export default function AddTodoItem({ onAddTodo, disabled }: AddTodoItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Helper function to format datetime for input (accepts optional hours offset)
  const getDateTimeString = (hoursOffset: number = 0) => {
    const now = new Date();
    now.setHours(now.getHours() + hoursOffset);
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  // Form state
  const [subject, setSubject] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [important, setImportant] = useState(false);
  const [status, setStatus] = useState<TodoStatus>('new');
  const [remarks, setRemarks] = useState('');
  const [etaDateTime, setEtaDateTime] = useState(() => getDateTimeString(24)); // 24 hours from now
  const [etsDateTime, setEtsDateTime] = useState(() => getDateTimeString());

  const resetForm = () => {
    setSubject('');
    setUrgent(false);
    setImportant(false);
    setStatus('new');
    setRemarks('');
    setEtaDateTime(getDateTimeString(24)); // 24 hours from now
    setEtsDateTime(getDateTimeString());
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!subject.trim()) {
      setError('Subject is required');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const todoItem: TodoItem = {
        subject: subject.trim(),
        urgent,
        important,
        status,
        etsDateTime: etsDateTime ? new Date(etsDateTime).toISOString() : undefined,
        etaDateTime: etaDateTime ? new Date(etaDateTime).toISOString() : undefined,
        remarks: remarks.trim() ? {
          type: 'text',
          content: remarks.trim(),
        } : undefined,
      };

      await onAddTodo(todoItem);
      resetForm();
      setIsOpen(false);
    } catch (err: any) {
      setError(err.message || 'Failed to create TODO item');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    resetForm();
    setIsOpen(false);
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        disabled={disabled}
        className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
        </svg>
        Add TODO
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
        <h2 className="text-xl font-bold mb-4 text-gray-900">Add New TODO Item</h2>
        
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Subject */}
          <div>
            <label htmlFor="subject" className="block text-sm font-medium text-gray-700 mb-1">
              Subject *
            </label>
            <input
              type="text"
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Enter task title"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
              disabled={isSubmitting}
            />
          </div>

          {/* Urgency & Importance */}
          <div className="grid grid-cols-2 gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={urgent}
                onChange={(e) => setUrgent(e.target.checked)}
                disabled={isSubmitting}
                className="w-4 h-4 text-red-600 border-gray-300 rounded focus:ring-red-500"
              />
              <span className="text-sm font-medium text-gray-700">Urgent</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={important}
                onChange={(e) => setImportant(e.target.checked)}
                disabled={isSubmitting}
                className="w-4 h-4 text-yellow-600 border-gray-300 rounded focus:ring-yellow-500"
              />
              <span className="text-sm font-medium text-gray-700">Important</span>
            </label>
          </div>

          {/* Status */}
          <div>
            <label htmlFor="status" className="block text-sm font-medium text-gray-700 mb-1">
              Status
            </label>
            <select
              id="status"
              value={status}
              onChange={(e) => setStatus(e.target.value as TodoStatus)}
              disabled={isSubmitting}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
            >
              <option value="new">New</option>
              <option value="inProgress">In Progress</option>
              <option value="blocked">Blocked</option>
              <option value="finished">Finished</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          {/* ETS DateTime */}
          <div>
            <label htmlFor="etsDateTime" className="block text-sm font-medium text-gray-700 mb-1">
              ETS (Estimated Start Time)
            </label>
            <input
              type="datetime-local"
              id="etsDateTime"
              value={etsDateTime}
              onChange={(e) => setEtsDateTime(e.target.value)}
              disabled={isSubmitting}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
            />
          </div>

          {/* ETA DateTime */}
          <div>
            <label htmlFor="etaDateTime" className="block text-sm font-medium text-gray-700 mb-1">
              ETA (Estimated Time of Accomplishment)
            </label>
            <input
              type="datetime-local"
              id="etaDateTime"
              value={etaDateTime}
              onChange={(e) => setEtaDateTime(e.target.value)}
              disabled={isSubmitting}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
            />
          </div>

          {/* Remarks */}
          <div>
            <label htmlFor="remarks" className="block text-sm font-medium text-gray-700 mb-1">
              Remarks
            </label>
            <textarea
              id="remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Add any notes or remarks..."
              rows={3}
              disabled={isSubmitting}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors resize-none"
            />
          </div>

          {/* Matrix Quadrant Preview */}
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-sm text-gray-600">
              Matrix Quadrant: {' '}
              <span className="font-semibold">
                {urgent && important && '🔴 Do First (Urgent & Important)'}
                {!urgent && important && '🟡 Schedule (Important, Not Urgent)'}
                {urgent && !important && '🟠 Delegate (Urgent, Not Important)'}
                {!urgent && !important && '⚪ Eliminate (Neither)'}
              </span>
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? 'Creating...' : 'Create TODO'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
