'use client';

import { useState } from 'react';
import { TodoItem, TodoStatus } from '@/lib/todoDataService';
import styles from './AddTodoItem.module.css';

interface AddTodoItemProps {
  onAddTodo: (todoItem: TodoItem) => Promise<void>;
  disabled?: boolean;
  defaultUrgent?: boolean;
  defaultImportant?: boolean;
  buttonText?: string;
  compact?: boolean;
}

export default function AddTodoItem({ onAddTodo, disabled, defaultUrgent = false, defaultImportant = false, buttonText = 'Add TODO', compact = false }: AddTodoItemProps) {
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
  const [urgent, setUrgent] = useState(defaultUrgent);
  const [important, setImportant] = useState(defaultImportant);
  const [status, setStatus] = useState<TodoStatus>('new');
  const [remarks, setRemarks] = useState('');
  const [etaDateTime, setEtaDateTime] = useState(() => getDateTimeString(24)); // 24 hours from now
  const [etsDateTime, setEtsDateTime] = useState(() => getDateTimeString());

  const resetForm = () => {
    setSubject('');
    setUrgent(defaultUrgent);
    setImportant(defaultImportant);
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

    // Validate ETS <= ETA
    if (etsDateTime && etaDateTime) {
      const etsDate = new Date(etsDateTime);
      const etaDate = new Date(etaDateTime);
      if (etsDate > etaDate) {
        setError('Estimated Start Time must be before or equal to Estimated Time of Accomplishment');
        return;
      }
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
        className={compact ? styles.addButtonCompact : styles.addButton}
      >
        {!compact && (
          <svg xmlns="http://www.w3.org/2000/svg" className={styles.icon} viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
        )}
        {compact ? '+' : buttonText}
      </button>
    );
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <h2 className={styles.title}>Add New TODO Item</h2>
        
        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className={styles.form}>
          {/* Subject */}
          <div className={styles.formGroup}>
            <label htmlFor="subject" className={styles.label}>
              Subject *
            </label>
            <input
              type="text"
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Enter task title"
              className={styles.input}
              disabled={isSubmitting}
            />
          </div>

          {/* Urgency & Importance */}
          <div className={styles.checkboxGrid}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={urgent}
                onChange={(e) => setUrgent(e.target.checked)}
                disabled={isSubmitting}
                className={styles.checkbox}
              />
              <span className={styles.checkboxText}>Urgent</span>
            </label>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={important}
                onChange={(e) => setImportant(e.target.checked)}
                disabled={isSubmitting}
                className={styles.checkbox}
              />
              <span className={styles.checkboxText}>Important</span>
            </label>
          </div>

          {/* Status */}
          <div className={styles.formGroup}>
            <label htmlFor="status" className={styles.label}>
              Status
            </label>
            <select
              id="status"
              value={status}
              onChange={(e) => setStatus(e.target.value as TodoStatus)}
              disabled={isSubmitting}
              className={styles.select}
            >
              <option value="new">New</option>
              <option value="inProgress">In Progress</option>
              <option value="blocked">Blocked</option>
              <option value="finished">Finished</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          {/* ETS DateTime */}
          <div className={styles.formGroup}>
            <label htmlFor="etsDateTime" className={styles.label}>
              ETS (Estimated Start Time)
            </label>
            <input
              type="datetime-local"
              id="etsDateTime"
              value={etsDateTime}
              onChange={(e) => setEtsDateTime(e.target.value)}
              disabled={isSubmitting}
              className={styles.input}
            />
          </div>

          {/* ETA DateTime */}
          <div className={styles.formGroup}>
            <label htmlFor="etaDateTime" className={styles.label}>
              ETA (Estimated Time of Accomplishment)
            </label>
            <input
              type="datetime-local"
              id="etaDateTime"
              value={etaDateTime}
              onChange={(e) => setEtaDateTime(e.target.value)}
              disabled={isSubmitting}
              className={styles.input}
            />
          </div>

          {/* Remarks */}
          <div className={styles.formGroup}>
            <label htmlFor="remarks" className={styles.label}>
              Remarks
            </label>
            <textarea
              id="remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Add any notes or remarks..."
              rows={3}
              disabled={isSubmitting}
              className={styles.textarea}
            />
          </div>

          {/* Matrix Quadrant Preview */}
          <div className={styles.preview}>
            <p className={styles.previewText}>
              Matrix Quadrant: {' '}
              <span className={styles.previewLabel}>
                {urgent && important && '🔴 Do First (Urgent & Important)'}
                {!urgent && important && '🟡 Schedule (Important, Not Urgent)'}
                {urgent && !important && '🟠 Delegate (Urgent, Not Important)'}
                {!urgent && !important && '⚪ Eliminate (Neither)'}
              </span>
            </p>
          </div>

          {/* Actions */}
          <div className={styles.actions}>
            <button
              type="button"
              onClick={handleCancel}
              disabled={isSubmitting}
              className={`${styles.button} ${styles.buttonSecondary}`}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={`${styles.button} ${styles.buttonPrimary}`}
            >
              {isSubmitting ? 'Creating...' : 'Create TODO'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
