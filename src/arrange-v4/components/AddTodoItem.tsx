'use client';

import { useState, useEffect, useCallback, useId, useMemo, useRef } from 'react';
import { TodoItem, TodoStatus } from '@/lib/store/types';
import { useModalDialog } from '@/lib/hooks/useModalDialog';
import { useDiscardGuard } from '@/lib/hooks/useDiscardGuard';
import { hasUnsavedChanges, type FormSnapshot } from '@/lib/unsavedChanges';
import {
  TODO_DIALOG_TABS,
  tabElementId,
  tabPanelElementId,
  type TodoDialogTab,
} from '@/lib/dialogTabs';
import ChecklistEditor from './ChecklistEditor';
import ConfirmDiscardDialog from './ConfirmDiscardDialog';
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

interface AddTodoFormValues {
  subject: string;
  urgent: boolean;
  important: boolean;
  status: TodoStatus;
  remarks: string;
  checklist: string[];
  etsDateTime: string;
  etaDateTime: string;
  categories: string[];
}

/**
 * The form's starting point, built in one go so the baseline the discard
 * prompt compares against is exactly what was put on screen. Reading the clock
 * twice could straddle a minute boundary and make an untouched form look
 * edited.
 */
function initialFormValues(
  defaultUrgent: boolean,
  defaultImportant: boolean,
  defaultStatus: TodoStatus,
): AddTodoFormValues {
  return {
    subject: '',
    urgent: defaultUrgent,
    important: defaultImportant,
    status: defaultStatus,
    remarks: '',
    checklist: [],
    etsDateTime: getDateTimeString(),
    etaDateTime: getDateTimeString(24), // 24 hours from now
    categories: [],
  };
}

/**
 * The form values as the save would see them.
 *
 * Whitespace alone never reaches the stored item — the subject is trimmed and
 * blank remarks are dropped — so it must not count as an unsaved change
 * either. Remarks that survive are compared verbatim, because Markdown is
 * whitespace-significant.
 */
function comparableValues(values: AddTodoFormValues): AddTodoFormValues {
  return {
    ...values,
    subject: values.subject.trim(),
    remarks: values.remarks.trim() ? values.remarks : '',
  };
}

export default function AddTodoItem({ onAddTodo, disabled, defaultUrgent = false, defaultImportant = false, defaultStatus = 'new', addLabel, buttonText = 'Add TODO', compact = false, availableCategories = [] }: AddTodoItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state, seeded from one snapshot that is also kept as the baseline the
  // unsaved-changes check compares against.
  const initialValuesRef = useRef<AddTodoFormValues>(
    initialFormValues(defaultUrgent, defaultImportant, defaultStatus),
  );
  const [subject, setSubject] = useState(initialValuesRef.current.subject);
  const [urgent, setUrgent] = useState(initialValuesRef.current.urgent);
  const [important, setImportant] = useState(initialValuesRef.current.important);
  const [status, setStatus] = useState<TodoStatus>(initialValuesRef.current.status);
  const [remarks, setRemarks] = useState(initialValuesRef.current.remarks);
  const [checklist, setChecklist] = useState<string[]>(initialValuesRef.current.checklist);
  const [etaDateTime, setEtaDateTime] = useState(initialValuesRef.current.etaDateTime);
  const [etsDateTime, setEtsDateTime] = useState(initialValuesRef.current.etsDateTime);
  const [categories, setCategories] = useState<string[]>(initialValuesRef.current.categories);
  const [activeTab, setActiveTab] = useState<TodoDialogTab>('essentials');
  // Bumped on every reset so the dirty check re-reads the new baseline; a ref
  // alone would not re-render, leaving a stale "unsaved changes" verdict.
  const [baselineVersion, setBaselineVersion] = useState(0);
  const tabsId = useId();

  const resetForm = useCallback(() => {
    const values = initialFormValues(defaultUrgent, defaultImportant, defaultStatus);
    initialValuesRef.current = values;
    setSubject(values.subject);
    setUrgent(values.urgent);
    setImportant(values.important);
    setStatus(values.status);
    setRemarks(values.remarks);
    setChecklist(values.checklist);
    setEtaDateTime(values.etaDateTime);
    setEtsDateTime(values.etsDateTime);
    setCategories(values.categories);
    setActiveTab('essentials');
    setError(null);
    setBaselineVersion(version => version + 1);
  }, [defaultUrgent, defaultImportant, defaultStatus]);

  const currentValues: AddTodoFormValues = {
    subject,
    urgent,
    important,
    status,
    remarks,
    checklist,
    etsDateTime,
    etaDateTime,
    categories,
  };
  const dirty = useMemo(
    () => hasUnsavedChanges(
      comparableValues(currentValues) as unknown as FormSnapshot,
      comparableValues(initialValuesRef.current) as unknown as FormSnapshot,
    ),
    // The baseline lives in a ref, so the version counter is what tells this
    // memo that it moved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subject, urgent, important, status, remarks, checklist, etsDateTime, etaDateTime, categories, baselineVersion],
  );

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

  const discardAndClose = useCallback(() => {
    resetForm();
    setIsOpen(false);
  }, [resetForm]);

  const { confirming, requestClose, confirmDiscard, cancelDiscard } = useDiscardGuard({
    dirty,
    busy: isSubmitting,
    onDiscard: discardAndClose,
  });

  const dialogRef = useModalDialog<HTMLDivElement>(isOpen, undefined, { paused: confirming });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const wasOpenRef = useRef(false);

  // The trigger unmounts while the dialog is open, so the dialog itself cannot
  // restore focus to it — put focus back once the button exists again.
  useEffect(() => {
    if (!isOpen && wasOpenRef.current) triggerRef.current?.focus();
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    // The discard prompt owns Escape while it is up, so this handler stands
    // down rather than closing the form out from under the question.
    if (!isOpen || confirming) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, confirming, requestClose]);

  if (!isOpen) {
    return (
      <button
        ref={triggerRef}
        onClick={() => {
          // Reset on the way in, so the baseline the discard prompt compares
          // against matches the form actually being shown.
          resetForm();
          setIsOpen(true);
        }}
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
            <button type="button" onClick={requestClose} disabled={isSubmitting}
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

      {confirming && (
        <ConfirmDiscardDialog
          subject="this new TODO item"
          onKeepEditing={cancelDiscard}
          onDiscard={confirmDiscard}
        />
      )}
    </div>
  );
}
