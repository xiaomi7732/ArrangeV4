'use client';

import { TodoItem, STATUS_LABELS } from '@/lib/todoDataService';
import styles from './AddTodoItem.module.css';

interface ViewTodoItemProps {
  todo: TodoItem & { id?: string };
  onClose: () => void;
}

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
            <span className={styles.value}>{STATUS_LABELS[todo.status || 'new']}</span>
          </div>

          {/* Urgency & Importance */}
          <div className={styles.checkboxGrid}>
            <div className={styles.formGroup}>
              <span className={styles.label}>Urgent</span>
              <span className={todo.urgent ? styles.valuePositive : styles.valueNegative}>
                {todo.urgent ? '✓ Yes' : '✗ No'}
              </span>
            </div>
            <div className={styles.formGroup}>
              <span className={styles.label}>Important</span>
              <span className={todo.important ? styles.valuePositive : styles.valueNegative}>
                {todo.important ? '✓ Yes' : '✗ No'}
              </span>
            </div>
          </div>

          {/* ETS DateTime */}
          <div className={styles.formGroup}>
            <span className={styles.label}>ETS (Estimated Start Time)</span>
            <span className={styles.value}>{formatDateTime(todo.etsDateTime)}</span>
          </div>

          {/* ETA DateTime */}
          <div className={styles.formGroup}>
            <span className={styles.label}>ETA (Estimated Time of Accomplishment)</span>
            <span className={styles.value}>{formatDateTime(todo.etaDateTime)}</span>
          </div>

          {/* Categories */}
          {todo.categories && todo.categories.length > 0 && (
            <div className={styles.formGroup}>
              <span className={styles.label}>Categories</span>
              <span className={styles.value}>{todo.categories.join(', ')}</span>
            </div>
          )}

          {/* Remarks */}
          {todo.remarks?.content && (
            <div className={styles.formGroup}>
              <span className={styles.label}>Remarks</span>
              <div className={styles.remarksBox}>{todo.remarks.content}</div>
            </div>
          )}

          {/* Checklist */}
          {todo.checklist && todo.checklist.length > 0 && (
            <div className={styles.formGroup}>
              <span className={styles.label}>Checklist</span>
              <ul className={styles.checklistBox}>
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
