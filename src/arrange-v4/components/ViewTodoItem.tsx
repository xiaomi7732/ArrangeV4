'use client';

import { useState } from 'react';
import { TodoItem, TodoStatus, STATUS_LABELS } from '@/lib/todoDataService';
import styles from './AddTodoItem.module.css';

interface ViewTodoItemProps {
  todo: TodoItem & { id?: string };
  onClose: () => void;
  onUpdate?: (updatedFields: Partial<TodoItem>) => Promise<void>;
}

export default function ViewTodoItem({ todo, onClose, onUpdate }: ViewTodoItemProps) {
  const [editing, setEditing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formatLocalDateTime = (isoString?: string) => {
    if (!isoString) return '';
    const d = new Date(isoString);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  // Edit form state
  const [subject, setSubject] = useState(todo.subject);
  const [urgent, setUrgent] = useState(todo.urgent ?? false);
  const [important, setImportant] = useState(todo.important ?? false);
  const [status, setStatus] = useState<TodoStatus>(todo.status || 'new');
  const [etsDateTime, setEtsDateTime] = useState(formatLocalDateTime(todo.etsDateTime));
  const [etaDateTime, setEtaDateTime] = useState(formatLocalDateTime(todo.etaDateTime));
  const [remarks, setRemarks] = useState(todo.remarks?.content || '');

  const getQuadrantLabel = (u: boolean, i: boolean) => {
    if (u && i) return '🔴 Do First (Urgent & Important)';
    if (!u && i) return '🟡 Schedule (Important, Not Urgent)';
    if (u && !i) return '🟠 Delegate (Urgent, Not Important)';
    return '⚪ Eliminate (Neither)';
  };

  const formatDateTime = (dateTime?: string) => {
    if (!dateTime) return 'Not set';
    return new Date(dateTime).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!subject.trim()) {
      setError('Subject is required');
      return;
    }
    if (etsDateTime && etaDateTime && new Date(etsDateTime) > new Date(etaDateTime)) {
      setError('Estimated Start Time must be before Estimated Time of Accomplishment');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const updatedFields: Partial<TodoItem> = {
        subject: subject.trim(),
        urgent,
        important,
        status,
        etsDateTime: etsDateTime ? new Date(etsDateTime).toISOString() : undefined,
        etaDateTime: etaDateTime ? new Date(etaDateTime).toISOString() : undefined,
        remarks: remarks.trim() ? { type: 'text', content: remarks.trim() } : undefined,
      };
      await onUpdate?.(updatedFields);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to update TODO item');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelEdit = () => {
    setSubject(todo.subject);
    setUrgent(todo.urgent ?? false);
    setImportant(todo.important ?? false);
    setStatus(todo.status || 'new');
    setEtsDateTime(formatLocalDateTime(todo.etsDateTime));
    setEtaDateTime(formatLocalDateTime(todo.etaDateTime));
    setRemarks(todo.remarks?.content || '');
    setError(null);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className={styles.overlay} onClick={onClose}>
        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
          <h2 className={styles.title}>Edit TODO Item</h2>

          {error && (
            <div className={styles.error} role="alert">{error}</div>
          )}

          <form onSubmit={handleSave} className={styles.form}>
            <div className={styles.formGroup}>
              <label htmlFor="edit-subject" className={styles.label}>Subject *</label>
              <input type="text" id="edit-subject" value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Enter task title" className={styles.input} disabled={isSubmitting} />
            </div>

            <div className={styles.checkboxGrid}>
              <label className={styles.checkboxLabel}>
                <input type="checkbox" checked={urgent}
                  onChange={(e) => setUrgent(e.target.checked)}
                  disabled={isSubmitting} className={styles.checkbox} />
                <span className={styles.checkboxText}>Urgent</span>
              </label>
              <label className={styles.checkboxLabel}>
                <input type="checkbox" checked={important}
                  onChange={(e) => setImportant(e.target.checked)}
                  disabled={isSubmitting} className={styles.checkbox} />
                <span className={styles.checkboxText}>Important</span>
              </label>
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="edit-status" className={styles.label}>Status</label>
              <select id="edit-status" value={status}
                onChange={(e) => setStatus(e.target.value as TodoStatus)}
                disabled={isSubmitting} className={styles.select}>
                <option value="new">New</option>
                <option value="inProgress">In Progress</option>
                <option value="blocked">Blocked</option>
                <option value="finished">Finished</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="edit-ets" className={styles.label}>ETS (Estimated Start Time)</label>
              <input type="datetime-local" id="edit-ets" value={etsDateTime}
                onChange={(e) => setEtsDateTime(e.target.value)}
                disabled={isSubmitting} className={styles.input} />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="edit-eta" className={styles.label}>ETA (Estimated Time of Accomplishment)</label>
              <input type="datetime-local" id="edit-eta" value={etaDateTime}
                onChange={(e) => setEtaDateTime(e.target.value)}
                disabled={isSubmitting} className={styles.input} />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="edit-remarks" className={styles.label}>Remarks</label>
              <textarea id="edit-remarks" value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Add any notes or remarks..." rows={3}
                disabled={isSubmitting} className={styles.textarea} />
            </div>

            <div className={styles.preview}>
              <p className={styles.previewText}>
                Matrix Quadrant:{' '}
                <span className={styles.previewLabel}>{getQuadrantLabel(urgent, important)}</span>
              </p>
            </div>

            <div className={styles.actions}>
              <button type="button" onClick={handleCancelEdit} disabled={isSubmitting}
                className={`${styles.button} ${styles.buttonSecondary}`}>
                Cancel
              </button>
              <button type="submit" disabled={isSubmitting}
                className={`${styles.button} ${styles.buttonPrimary}`}>
                {isSubmitting ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>{todo.subject}</h2>

        <div className={styles.form}>
          <div className={styles.formGroup}>
            <span className={styles.label}>Status</span>
            <span className={styles.value}>{STATUS_LABELS[todo.status || 'new']}</span>
          </div>

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

          <div className={styles.formGroup}>
            <span className={styles.label}>ETS (Estimated Start Time)</span>
            <span className={styles.value}>{formatDateTime(todo.etsDateTime)}</span>
          </div>

          <div className={styles.formGroup}>
            <span className={styles.label}>ETA (Estimated Time of Accomplishment)</span>
            <span className={styles.value}>{formatDateTime(todo.etaDateTime)}</span>
          </div>

          {todo.categories && todo.categories.length > 0 && (
            <div className={styles.formGroup}>
              <span className={styles.label}>Categories</span>
              <span className={styles.value}>{todo.categories.join(', ')}</span>
            </div>
          )}

          {todo.remarks?.content && (
            <div className={styles.formGroup}>
              <span className={styles.label}>Remarks</span>
              <div className={styles.remarksBox}>{todo.remarks.content}</div>
            </div>
          )}

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

          <div className={styles.preview}>
            <p className={styles.previewText}>
              Matrix Quadrant:{' '}
              <span className={styles.previewLabel}>{getQuadrantLabel(todo.urgent ?? false, todo.important ?? false)}</span>
            </p>
          </div>

          <div className={styles.actions}>
            {onUpdate && (
              <button type="button" onClick={() => setEditing(true)}
                className={`${styles.button} ${styles.buttonPrimary}`}>
                Edit
              </button>
            )}
            <button type="button" onClick={onClose}
              className={`${styles.button} ${styles.buttonSecondary}`}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
