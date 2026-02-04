'use client';

import { TodoItem, TodoStatus } from '@/lib/todoDataService';
import styles from './AddTodoItem.module.css';

interface ViewTodoItemProps {
  todo: TodoItem & { id?: string };
  onClose: () => void;
}

const statusLabels: Record<TodoStatus, string> = {
  new: 'New',
  inProgress: 'In Progress',
  blocked: 'Blocked',
  finished: 'Finished',
  cancelled: 'Cancelled',
};

export default function ViewTodoItem({ todo, onClose }: ViewTodoItemProps) {
  const getQuadrantLabel = () => {
    if (todo.urgent && todo.important) return '🔴 Do First (Urgent & Important)';
    if (!todo.urgent && todo.important) return '🟡 Schedule (Important, Not Urgent)';
    if (todo.urgent && !todo.important) return '🟠 Delegate (Urgent, Not Important)';
    return '⚪ Eliminate (Neither)';
  };

  const formatDateTime = (dateTime?: string) => {
    if (!dateTime) return 'Not set';
    return new Date(dateTime).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>{todo.subject}</h2>

        <div className={styles.form}>
          {/* Status */}
          <div className={styles.formGroup}>
            <span className={styles.label}>Status</span>
            <span>{statusLabels[todo.status || 'new']}</span>
          </div>

          {/* Urgency & Importance */}
          <div className={styles.checkboxGrid}>
            <div className={styles.formGroup}>
              <span className={styles.label}>Urgent</span>
              <span>{todo.urgent ? '✓ Yes' : '✗ No'}</span>
            </div>
            <div className={styles.formGroup}>
              <span className={styles.label}>Important</span>
              <span>{todo.important ? '✓ Yes' : '✗ No'}</span>
            </div>
          </div>

          {/* ETS DateTime */}
          <div className={styles.formGroup}>
            <span className={styles.label}>ETS (Estimated Start Time)</span>
            <span>{formatDateTime(todo.etsDateTime)}</span>
          </div>

          {/* ETA DateTime */}
          <div className={styles.formGroup}>
            <span className={styles.label}>ETA (Estimated Time of Accomplishment)</span>
            <span>{formatDateTime(todo.etaDateTime)}</span>
          </div>

          {/* Categories */}
          {todo.categories && todo.categories.length > 0 && (
            <div className={styles.formGroup}>
              <span className={styles.label}>Categories</span>
              <span>{todo.categories.join(', ')}</span>
            </div>
          )}

          {/* Remarks */}
          {todo.remarks?.content && (
            <div className={styles.formGroup}>
              <span className={styles.label}>Remarks</span>
              <span>{todo.remarks.content}</span>
            </div>
          )}

          {/* Checklist */}
          {todo.checklist && todo.checklist.length > 0 && (
            <div className={styles.formGroup}>
              <span className={styles.label}>Checklist</span>
              <ul style={{ margin: 0, paddingLeft: '20px' }}>
                {todo.checklist.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Matrix Quadrant */}
          <div className={styles.preview}>
            <p className={styles.previewText}>
              Matrix Quadrant:{' '}
              <span className={styles.previewLabel}>{getQuadrantLabel()}</span>
            </p>
          </div>

          {/* Actions */}
          <div className={styles.actions}>
            <button
              type="button"
              onClick={onClose}
              className={`${styles.button} ${styles.buttonSecondary}`}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
