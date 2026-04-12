'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar } from '@/lib/graphService';
import { getCalendarDisplayName } from '@/lib/calendarUtils';
import styles from './CalendarList.module.css';

interface CalendarListProps {
  calendars: Calendar[];
  loading: boolean;
  error: string | null;
  onDeleteCalendar: (calendarId: string) => Promise<void>;
}

export default function CalendarList({ calendars, loading, error, onDeleteCalendar }: CalendarListProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [dismissResetKey, setDismissResetKey] = useState(0);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const deleteButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const router = useRouter();

  // Auto-dismiss confirmation after 5 seconds of inactivity
  useEffect(() => {
    if (!confirmingId || deletingId === confirmingId) return;
    const savedId = confirmingId;
    const timer = setTimeout(() => {
      setConfirmingId(null);
      // Defer focus restoration until delete button remounts
      requestAnimationFrame(() => {
        const btn = deleteButtonRefs.current.get(savedId);
        if (btn) btn.focus();
      });
    }, 5000);
    return () => clearTimeout(timer);
  }, [confirmingId, deletingId, dismissResetKey]);

  const resetDismissTimer = useCallback(() => {
    setDismissResetKey(k => k + 1);
  }, []);

  // Move focus to the Confirm Delete button when confirmation row appears
  useEffect(() => {
    if (confirmingId) {
      confirmButtonRef.current?.focus();
    }
  }, [confirmingId]);

  const handleCalendarClick = (calendar: Calendar) => {
    if (calendar.id) {
      router.push(`/matrix?bookId=${encodeURIComponent(calendar.id)}`);
    }
  };

  const handleDelete = useCallback(async (calendar: Calendar) => {
    if (!calendar.id) return;

    setDeletingId(calendar.id);
    try {
      await onDeleteCalendar(calendar.id);
    } catch (error) {
      console.error('Failed to delete book:', error);
      alert('Failed to delete book. Please try again.');
    } finally {
      const calId = calendar.id;
      setDeletingId(null);
      setConfirmingId(prev => prev === calId ? null : prev);
      // Defer focus restoration until delete button remounts after confirmation row unmounts
      if (calId) {
        requestAnimationFrame(() => {
          const btn = deleteButtonRefs.current.get(calId);
          if (btn) btn.focus();
        });
      }
    }
  }, [onDeleteCalendar]);
  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner}></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.error} role="alert">
        <span className={styles.errorBold}>Error: </span>
        <span>{error}</span>
      </div>
    );
  }

  if (calendars.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>No books yet</p>
        <p className={styles.emptyHint}>
          Create your first book using the <strong>New Book</strong> button above. Each book is a separate collection of tasks organized in an Eisenhower Matrix.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h2 className={styles.sectionTitle}>Your Books</h2>
      <div className={styles.grid}>
        {calendars.map((calendar) => (
          <div
            key={calendar.id}
            className={styles.calendarCard}
            onClick={() => handleCalendarClick(calendar)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if ((e.target as HTMLElement).closest('button')) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleCalendarClick(calendar);
              }
            }}
          >
            <div className={styles.calendarTop}>
              <div>
                <h3 className={styles.calendarName}>
                  {getCalendarDisplayName(calendar)}
                </h3>
                {calendar.owner && (
                  <p className={styles.calendarOwner}>
                    Owner: {calendar.owner.name || calendar.owner.address}
                  </p>
                )}
                <div className={styles.badges}>
                  {calendar.canEdit && (
                    <span className={`${styles.badge} ${styles.badgeGreen}`}>
                      Can Edit
                    </span>
                  )}
                  {calendar.canShare && (
                    <span className={`${styles.badge} ${styles.badgeBlue}`}>
                      Can Share
                    </span>
                  )}
                  {calendar.canViewPrivateItems && (
                    <span className={`${styles.badge} ${styles.badgePurple}`}>
                      View Private
                    </span>
                  )}
                </div>
              </div>
              {calendar.color && (
                <div
                  className={styles.colorDot}
                  style={{ backgroundColor: calendar.color }}
                  title={`Color: ${calendar.color}`}
                />
              )}
            </div>
            {calendar.id && (
              <p className={styles.calendarId} title={calendar.id}>
                ID: {calendar.id}
              </p>
            )}
            <div className={styles.calendarFooter}>
              {calendar.id && (() => {
                const bookName = getCalendarDisplayName(calendar);
                const bookId = calendar.id;
                return confirmingId === bookId ? (
                  <div
                    className={styles.deleteConfirmRow}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onMouseMove={resetDismissTimer}
                    onFocus={resetDismissTimer}
                  >
                    <button
                      onClick={() => {
                        setConfirmingId(null);
                        requestAnimationFrame(() => {
                          const btn = deleteButtonRefs.current.get(bookId);
                          if (btn) btn.focus();
                        });
                      }}
                      disabled={!!deletingId}
                      className={styles.deleteCancelButton}
                      aria-label={`Cancel deleting ${bookName}`}
                    >
                      Cancel
                    </button>
                    <button
                      ref={confirmingId === bookId ? confirmButtonRef : undefined}
                      onClick={() => handleDelete(calendar)}
                      disabled={!!deletingId}
                      className={styles.deleteConfirmButton}
                      aria-label={`Confirm delete ${bookName}`}
                    >
                      {deletingId === bookId ? 'Deleting...' : 'Confirm Delete'}
                    </button>
                  </div>
                ) : (
                  <button
                    ref={(el) => {
                      if (el && bookId) deleteButtonRefs.current.set(bookId, el);
                      else if (!el && bookId) deleteButtonRefs.current.delete(bookId);
                    }}
                    onClick={(e) => { e.stopPropagation(); setConfirmingId(bookId ?? null); }}
                    disabled={!!deletingId}
                    className={styles.deleteButton}
                    aria-label={`Delete ${bookName}`}
                  >
                    🗑 Delete
                  </button>
                );
              })()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
