'use client';

import { useState, useEffect } from 'react';
import styles from './CreateCalendar.module.css';

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
      setError('Book name is required');
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
      setError(err.message || 'Failed to create book');
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
      if (e.key === 'Escape' && !isCreating) handleCancel();
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
                <p className={styles.hint}>
                  &quot; by arrange&quot; will be automatically added to the end
                </p>
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
