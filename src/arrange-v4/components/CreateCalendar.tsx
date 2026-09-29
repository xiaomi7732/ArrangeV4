'use client';

import { useState, useEffect } from 'react';
import styles from './CreateCalendar.module.css';

interface CreateCalendarProps {
  onCreateCalendar: (name: string) => Promise<void>;
  disabled?: boolean;
  appendArrangeSuffix?: boolean;
}

export default function CreateCalendar({
  onCreateCalendar,
  disabled = false,
  appendArrangeSuffix = true,
}: CreateCalendarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [calendarName, setCalendarName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!calendarName.trim()) {
      setError('Book name is required');
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const finalName = appendArrangeSuffix
        && !calendarName.toLowerCase().endsWith(' by arrange')
        ? `${calendarName} by arrange`
        : calendarName;
      
      await onCreateCalendar(finalName);
      
      // Reset form and close modal on success
      setCalendarName('');
      setIsOpen(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create book');
    } finally {
      setIsCreating(false);
    }
  };

  const handleCancel = () => {
    setIsOpen(false);
    setCalendarName('');
    setError(null);
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isCreating) {
        setIsOpen(false);
        setCalendarName('');
        setError(null);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, isCreating]);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        disabled={disabled}
        className={styles.button}
      >
        Create Book
      </button>

      {isOpen && (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <h2 className={styles.modalTitle}>Create New Book</h2>
            
            <form onSubmit={handleSubmit}>
              <div className={styles.fieldGroup}>
                <label htmlFor="calendarName" className={styles.label}>
                  Book Name
                </label>
                <input
                  type="text"
                  id="calendarName"
                  value={calendarName}
                  onChange={(e) => setCalendarName(e.target.value)}
                  placeholder="My Book"
                  className={styles.input}
                  disabled={isCreating}
                  autoFocus
                />
                {appendArrangeSuffix && (
                  <p className={styles.hint}>
                    &quot; by arrange&quot; will be automatically added to the end
                  </p>
                )}
              </div>

              {error && (
                <div className={styles.error}>
                  {error}
                </div>
              )}

              <div className={styles.modalActions}>
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={isCreating}
                  className={styles.cancelButton}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating || !calendarName.trim()}
                  className={styles.submitButton}
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
