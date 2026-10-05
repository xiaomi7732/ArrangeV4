'use client';

import { useCallback, useEffect, useState } from 'react';
import { validateBookName } from '@/lib/books/bookName';
import { useDiscardGuard } from '@/lib/hooks/useDiscardGuard';
import ConfirmDiscardDialog from './ConfirmDiscardDialog';
import styles from './CreateCalendar.module.css';

interface CreateCalendarProps {
  onCreateCalendar: (name: string) => Promise<void>;
  disabled?: boolean;
  appendArrangeSuffix?: boolean;
  /** Display names of the books that already exist, used to reject duplicates. */
  existingNames?: readonly string[];
}

export default function CreateCalendar({
  onCreateCalendar,
  disabled = false,
  appendArrangeSuffix = true,
  existingNames = [],
}: CreateCalendarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [calendarName, setCalendarName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validation = validateBookName(calendarName, existingNames, { stripArrangeSuffix: appendArrangeSuffix });
    if (!validation.ok) {
      setError(validation.error);
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const finalName = appendArrangeSuffix
        ? `${validation.name} by arrange`
        : validation.name;

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

  const handleCancel = useCallback(() => {
    setIsOpen(false);
    setCalendarName('');
    setError(null);
  }, []);

  // Whitespace alone is nothing worth protecting, so the prompt waits for a
  // name the user could actually submit.
  const { confirming, requestClose, confirmDiscard, cancelDiscard } = useDiscardGuard({
    dirty: calendarName.trim().length > 0,
    busy: isCreating,
    onDiscard: handleCancel,
  });

  useEffect(() => {
    if (!isOpen || confirming) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, confirming, requestClose]);

  const liveValidation = validateBookName(calendarName, existingNames, { stripArrangeSuffix: appendArrangeSuffix });
  // Only surface the live message once the user has typed something, so the
  // empty form does not open with a red "required" error.
  const liveError = calendarName.trim() && !liveValidation.ok ? liveValidation.error : null;
  const shownError = error ?? liveError;

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
                  onChange={(e) => {
                    setCalendarName(e.target.value);
                    setError(null);
                  }}
                  placeholder="My Book"
                  className={styles.input}
                  disabled={isCreating}
                  aria-invalid={shownError ? true : undefined}
                  aria-describedby={shownError ? 'calendarNameError' : undefined}
                  autoFocus
                />
                {appendArrangeSuffix && (
                  <p className={styles.hint}>
                    &quot; by arrange&quot; will be automatically added to the end
                  </p>
                )}
              </div>

              {shownError && (
                <div className={styles.error} id="calendarNameError" role="alert">
                  {shownError}
                </div>
              )}

              <div className={styles.modalActions}>
                <button
                  type="button"
                  onClick={requestClose}
                  disabled={isCreating}
                  className={styles.cancelButton}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating || !liveValidation.ok}
                  className={styles.submitButton}
                >
                  {isCreating ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>

          {confirming && (
            <ConfirmDiscardDialog
              subject="this new book"
              onKeepEditing={cancelDiscard}
              onDiscard={confirmDiscard}
            />
          )}
        </div>
      )}
    </>
  );
}
