'use client';

import { useState, useEffect, useCallback, useId, useRef } from 'react';
import { TodoItem, TodoStatus } from '@/lib/store/types';
import { useModalDialog } from '@/lib/hooks/useModalDialog';
import {
  TODO_DIALOG_TABS,
  tabElementId,
  tabPanelElementId,
  type TodoDialogTab,
} from '@/lib/dialogTabs';
import ChecklistEditor from './ChecklistEditor';
import DialogTabs from './DialogTabs';
import RemarksEditor from './RemarksEditor';
import TagPicker from './TagPicker';
import styles from './AddTodoItem.module.css';

interface AddTodoItemProps {
  onAddTodo: (todoItem: TodoItem) => Promise<void>;
  disabled?: boolean;
  defaultUrgent?: boolean;
  defaultImportant?: boolean;
  /** Accessible name for the trigger, needed when compact renders only a +. */
  addLabel?: string;
  /** Status the new item starts in, e.g. the Scrum lane the add button sits in. */
  defaultStatus?: TodoStatus;
  buttonText?: string;
  compact?: boolean;
  availableCategories?: string[];
}

// Helper function to format datetime for input (accepts optional hours offset)
function getDateTimeString(hoursOffset: number = 0) {
  const now = new Date();
  now.setHours(now.getHours() + hoursOffset);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export default function AddTodoItem({ onAddTodo, disabled, defaultUrgent = false, defaultImportant = false, defaultStatus = 'new', addLabel, buttonText = 'Add TODO', compact = false, availableCategories = [] }: AddTodoItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [subject, setSubject] = useState('');
  const [urgent, setUrgent] = useState(defaultUrgent);
  const [important, setImportant] = useState(defaultImportant);
  const [status, setStatus] = useState<TodoStatus>(defaultStatus);
  const [remarks, setRemarks] = useState('');
  const [checklist, setChecklist] = useState<string[]>([]);
  const [etaDateTime, setEtaDateTime] = useState(() => getDateTimeString(24)); // 24 hours from now
  const [etsDateTime, setEtsDateTime] = useState(() => getDateTimeString());
  const [categories, setCategories] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<TodoDialogTab>('essentials');
  const tabsId = useId();

  const resetForm = useCallback(() => {
    setSubject('');
    setUrgent(defaultUrgent);
    setImportant(defaultImportant);
    setStatus(defaultStatus);
    setRemarks('');
    setChecklist([]);
    setEtaDateTime(getDateTimeString(24)); // 24 hours from now
    setEtsDateTime(getDateTimeString());
    setCategories([]);
    setActiveTab('essentials');
    setError(null);
  }, [defaultUrgent, defaultImportant, defaultStatus]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!subject.trim()) {
      setError('Subject is required');
      return;
    }

    // Validate ETS <= ETA
    if (etsDateTime && etaDateTime) {
      const etsDate = new Date(etsDateTime);
      const etaDate = new Date(etaDateTime);
      if (etsDate > etaDate) {
        setError('Estimated Start Time must be before or equal to Estimated Time of Accomplishment');
        return;
      }
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const todoItem: TodoItem = {
        subject: subject.trim(),
        urgent,
        important,
        status,
        etsDateTime: etsDateTime ? new Date(etsDateTime).toISOString() : undefined,
        etaDateTime: etaDateTime ? new Date(etaDateTime).toISOString() : undefined,
        remarks: remarks.trim() ? {
          type: 'markdown',
          // Verbatim: Markdown is whitespace-significant.
          content: remarks,
        } : undefined,
        checklist: checklist.length > 0 ? checklist : undefined,
        categories: categories.length > 0 ? categories : undefined,
      };

      await onAddTodo(todoItem);
      resetForm();
      setIsOpen(false);
    } catch (err: any) {
      setError(err.message || 'Failed to create TODO item');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    resetForm();
    setIsOpen(false);
  };

  const dialogRef = useModalDialog<HTMLDivElement>(isOpen);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const wasOpenRef = useRef(false);

  // The trigger unmounts while the dialog is open, so the dialog itself cannot
  // restore focus to it — put focus back once the button exists again.
  useEffect(() => {
    if (!isOpen && wasOpenRef.current) triggerRef.current?.focus();
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        resetForm();
        setIsOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, isSubmitting, resetForm]);

  if (!isOpen) {
    return (
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(true)}
        disabled={disabled}
        className={compact ? styles.addButtonCompact : styles.addButton}
        title={addLabel}
        aria-label={addLabel}
      >
        {!compact && (
          <svg xmlns="http://www.w3.org/2000/svg" className={styles.icon} viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
        )}
        {compact ? '+' : buttonText}
      </button>
    );
  }

  return (
    <div className={styles.overlay}>
      <div
        ref={dialogRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-todo-title"
        tabIndex={-1}
      >
        <h2 id="add-todo-title" className={styles.title}>Add New TODO Item</h2>
        
        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className={styles.form}>
          <DialogTabs
            tabs={TODO_DIALOG_TABS}
            activeTab={activeTab}
            onChange={setActiveTab}
            idPrefix={tabsId}
            ariaLabel="TODO item sections"
            className={styles.tabBar}
            tabClassName={styles.tab}
            activeTabClassName={styles.tabActive}
          />

          {activeTab === 'essentials' && (
            <div
              className={styles.tabContent}
              role="tabpanel"
              id={tabPanelElementId(tabsId, 'essentials')}
              aria-labelledby={tabElementId(tabsId, 'essentials')}
            >
              <div className={styles.formGroup}>
                <label htmlFor="subject" className={styles.label}>Subject *</label>
                <input type="text" id="subject" value={subject}
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
                <label htmlFor="status" className={styles.label}>Status</label>
                <select id="status" value={status}
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
                <label htmlFor="etsDateTime" className={styles.label}>ETS (Estimated Start Time)</label>
                <input type="datetime-local" id="etsDateTime" value={etsDateTime}
                  onChange={(e) => setEtsDateTime(e.target.value)}
                  disabled={isSubmitting} className={styles.input} />
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="etaDateTime" className={styles.label}>ETA (Estimated Time of Accomplishment)</label>
                <input type="datetime-local" id="etaDateTime" value={etaDateTime}
                  onChange={(e) => setEtaDateTime(e.target.value)}
                  disabled={isSubmitting} className={styles.input} />
              </div>

              <div className={styles.preview}>
                <p className={styles.previewText}>
                  Matrix Quadrant:{' '}
                  <span className={styles.previewLabel}>
                    {urgent && important && '🔴 Do First (Urgent & Important)'}
                    {!urgent && important && '🟡 Schedule (Important, Not Urgent)'}
                    {urgent && !important && '🟠 Delegate (Urgent, Not Important)'}
                    {!urgent && !important && '⚪ Eliminate (Neither)'}
                  </span>
                </p>
              </div>
            </div>
          )}

          {activeTab === 'tags' && (
            <div
              className={styles.tabContent}
              role="tabpanel"
              id={tabPanelElementId(tabsId, 'tags')}
              aria-labelledby={tabElementId(tabsId, 'tags')}
            >
              <TagPicker
                availableCategories={availableCategories}
                categories={categories}
                onChange={setCategories}
                disabled={isSubmitting}
              />
            </div>
          )}

          {activeTab === 'remarks' && (
            <div
              className={styles.tabContent}
              role="tabpanel"
              id={tabPanelElementId(tabsId, 'remarks')}
              aria-labelledby={tabElementId(tabsId, 'remarks')}
            >
              <RemarksEditor
                textareaId="remarks"
                value={remarks}
                onChange={setRemarks}
                disabled={isSubmitting}
                isMarkdown
              />
            </div>
          )}

          {activeTab === 'checklist' && (
            <div
              className={styles.tabContent}
              role="tabpanel"
              id={tabPanelElementId(tabsId, 'checklist')}
              aria-labelledby={tabElementId(tabsId, 'checklist')}
            >
              <div className={styles.formGroup}>
                <label className={styles.label}>Checklist</label>
                <ChecklistEditor
                  items={checklist}
                  onChange={setChecklist}
                  disabled={isSubmitting}
                  showRemoveButton
                  showAddInput
                />
              </div>
            </div>
          )}

          <div className={styles.actions}>
            <button type="button" onClick={handleCancel} disabled={isSubmitting}
              className={`${styles.button} ${styles.buttonSecondary}`}>
              Cancel
            </button>
            <button type="submit" disabled={isSubmitting}
              className={`${styles.button} ${styles.buttonPrimary}`}>
              {isSubmitting ? 'Creating...' : 'Create TODO'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
