'use client';

import { TodoItemWithId } from '@/lib/store/types';
import { formatRelativeDate } from '@/lib/dateUtils';
import { describeDateBump } from '@/lib/bumpNotice';
import styles from './ScrumCard.module.css';

interface ScrumCardProps {
  todo: TodoItemWithId;
  onClick?: (todo: TodoItemWithId) => void;
}

export default function ScrumCard({ todo, onClick }: ScrumCardProps) {
  const bumpedFrom = describeDateBump(todo);

  return (
    <div
      className={styles.card}
      onClick={() => onClick?.(todo)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.(todo);
        }
      }}
    >
      <div className={styles.subject} title={todo.subject}>{todo.subject}</div>
      <div className={styles.badges}>
        {todo.important && <span className={`${styles.badge} ${styles.badgeImportant}`}>Important</span>}
        {todo.urgent && <span className={`${styles.badge} ${styles.badgeUrgent}`}>Urgent</span>}
        {todo.etaDateTime && todo.status !== 'finished' && todo.status !== 'cancelled' && (() => {
          const eta = formatRelativeDate(todo.etaDateTime, new Date(), 'deadline');
          return (
            <span
              className={`${styles.eta} ${eta.isOverdue ? styles.etaOverdue : ''}`}
              title={`ETA: ${eta.fullDate}`}
            >
              ETA: {eta.text}
            </span>
          );
        })()}
        {bumpedFrom && (
          <span className={styles.bumped} title={bumpedFrom.tooltip} aria-label={bumpedFrom.tooltip}>
            ↻ moved from {bumpedFrom.text}
          </span>
        )}
      </div>
      {todo.categories && todo.categories.length > 0 && (
        <div className={styles.categories}>
          {todo.categories.map(cat => (
            <span key={cat} className={styles.category}>{cat}</span>
          ))}
        </div>
      )}
    </div>
  );
}
