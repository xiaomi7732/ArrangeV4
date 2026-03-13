'use client';

import { useState } from 'react';
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
  const router = useRouter();

  const handleCalendarClick = (calendar: Calendar) => {
    if (calendar.id) {
      router.push(`/matrix?bookId=${encodeURIComponent(calendar.id)}`);
    }
  };

  const handleDelete = async (calendar: Calendar) => {
    if (!calendar.id) return;
    
    const displayName = getCalendarDisplayName(calendar);
    if (!confirm(`Are you sure you want to delete "${displayName}"?`)) {
      return;
    }

    setDeletingId(calendar.id);
    try {
      await onDeleteCalendar(calendar.id);
    } catch (error) {
      console.error('Failed to delete book:', error);
      alert('Failed to delete book. Please try again.');
    } finally {
      setDeletingId(null);
    }
  };
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
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(calendar); }}
                disabled={deletingId === calendar.id}
                className={styles.deleteButton}
              >
                {deletingId === calendar.id ? 'Deleting...' : 'Delete Book'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
