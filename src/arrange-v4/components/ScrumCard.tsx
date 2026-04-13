'use client';

import { TodoItem } from '@/lib/todoDataService';
import { formatRelativeDate } from '@/lib/dateUtils';
import styles from './ScrumCard.module.css';

interface ScrumCardProps {
  todo: TodoItem & { id?: string };
  onDragStart?: (todo: TodoItem & { id?: string }) => void;
  onDragEnd?: () => void;
  onClick?: (todo: TodoItem & { id?: string }) => void;
}

export default function ScrumCard({ todo, onDragStart, onDragEnd, onClick }: ScrumCardProps) {

  return (
    <div
      className={styles.card}
      draggable={!!todo.id}
      onDragStart={() => onDragStart?.(todo)}
      onDragEnd={() => onDragEnd?.()}
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
      <div className={styles.subject}>{todo.subject}</div>
      <div className={styles.badges}>
        {todo.important && <span className={`${styles.badge} ${styles.badgeImportant}`}>Important</span>}
        {todo.urgent && <span className={`${styles.badge} ${styles.badgeUrgent}`}>Urgent</span>}
        {todo.etaDateTime && (() => {
          const label = formatRelativeDate(todo.etaDateTime);
          const isOverdue = label.includes('overdue');
          return (
            <span className={`${styles.eta} ${isOverdue ? styles.etaOverdue : ''}`}>ETA: {label}</span>
          );
        })()}
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
