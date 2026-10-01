'use client';

import { useState, useEffect, useCallback, useId } from 'react';
import { TodoItem, TodoStatus, STATUS_LABELS } from '@/lib/store/types';
import { useModalDialog } from '@/lib/hooks/useModalDialog';
import { formatAbsoluteDateTime } from '@/lib/dateUtils';
import { describeDateBump } from '@/lib/bumpNotice';
import {
  TODO_DIALOG_TABS,
  tabElementId,
  tabPanelElementId,
  type TodoDialogTab,
} from '@/lib/dialogTabs';
import ChecklistEditor from './ChecklistEditor';
import DialogTabs from './DialogTabs';
import MarkdownView from './MarkdownView';
import RemarksEditor from './RemarksEditor';
import TagPicker from './TagPicker';
import styles from './AddTodoItem.module.css';

interface ViewTodoItemProps {
  todo: TodoItem & {
    id?: string;
    source?: {
      url: string;
      label: string;
    };
  };
  onClose: () => void;
  onUpdate?: (updatedFields: Partial<TodoItem>) => Promise<void>;
  availableCategories?: string[];
}

type ViewTab = TodoDialogTab;

function formatLocalDateTime(isoString?: string) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ViewTodoItem({ todo, onClose, onUpdate, availableCategories = [] }: ViewTodoItemProps) {
  const [editing, setEditing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checklistUpdating, setChecklistUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ViewTab>('essentials');
  const tabsId = useId();
  // Optimistic local state for view-mode checklist (tracks pending changes before server confirms)
  const [viewChecklist, setViewChecklist] = useState<string[] | null>(null);
  const displayChecklist = viewChecklist ?? todo.checklist;

  // Reset optimistic state when the todo changes (different item selected)
  useEffect(() => {
    setViewChecklist(null);
  }, [todo.id]);

  // Edit form state
  const [subject, setSubject] = useState(todo.subject);
  const [urgent, setUrgent] = useState(todo.urgent ?? false);
  const [important, setImportant] = useState(todo.important ?? false);
  const [status, setStatus] = useState<TodoStatus>(todo.status || 'new');
  const [etsDateTime, setEtsDateTime] = useState(formatLocalDateTime(todo.etsDateTime));
  const [etaDateTime, setEtaDateTime] = useState(formatLocalDateTime(todo.etaDateTime));
  const [remarks, setRemarks] = useState(todo.remarks?.content || '');
  // A remark with no stored type predates Markdown support, so it stays plain
  // until the user opts it in; anything new is authored as Markdown.
  const [remarksMarkdown, setRemarksMarkdown] = useState(
    !todo.remarks || todo.remarks.type === 'markdown',
  );
  const [checklist, setChecklist] = useState<string[]>(todo.checklist || []);
  const [categories, setCategories] = useState<string[]>(todo.categories || []);

  const getQuadrantLabel = (u: boolean, i: boolean) => {
    if (u && i) return '🔴 Do First (Urgent & Important)';
    if (!u && i) return '🟡 Schedule (Important, Not Urgent)';
    if (u && !i) return '🟠 Delegate (Urgent, Not Important)';
    return '⚪ Eliminate (Neither)';
  };

  const formatDateTime = (dateTime?: string) => {
    if (!dateTime) return 'Not set';
    return formatAbsoluteDateTime(dateTime);
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
      const updatedFields: Partial<TodoItem> = {};
      const nextSubject = subject.trim();
      const nextEts = etsDateTime ? new Date(etsDateTime).toISOString() : undefined;
      const nextEta = etaDateTime ? new Date(etaDateTime).toISOString() : undefined;
      const nextRemarks = remarks.trim()
        ? {
            type: (remarksMarkdown ? 'markdown' : 'text') as 'markdown' | 'text',
            content: remarks.trim(),
          }
        : null;
      const nextChecklist = checklist.length > 0 ? checklist : [];
      const nextCategories = categories.length > 0 ? categories : [];
      const sameValue = (left: unknown, right: unknown) =>
        JSON.stringify(left) === JSON.stringify(right);

      if (subject !== todo.subject) updatedFields.subject = nextSubject;
      if (urgent !== (todo.urgent ?? false)) updatedFields.urgent = urgent;
      if (important !== (todo.important ?? false)) updatedFields.important = important;
      if (status !== (todo.status || 'new')) updatedFields.status = status;
      if (etsDateTime !== formatLocalDateTime(todo.etsDateTime)) {
        updatedFields.etsDateTime = nextEts;
      }
      if (etaDateTime !== formatLocalDateTime(todo.etaDateTime)) {
        updatedFields.etaDateTime = nextEta;
      }
      const remarksChanged =
        remarks.trim() !== (todo.remarks?.content || '') ||
        (nextRemarks !== null && nextRemarks.type !== (todo.remarks?.type || 'text'));
      if (remarksChanged) updatedFields.remarks = nextRemarks;
      if (!sameValue(nextChecklist, todo.checklist || [])) {
        updatedFields.checklist = nextChecklist;
      }
      if (!sameValue(nextCategories, todo.categories || [])) {
        updatedFields.categories = nextCategories;
      }

      if (Object.keys(updatedFields).length === 0) {
        onClose();
        return;
      }
      await onUpdate?.(updatedFields);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update TODO item');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelEdit = useCallback(() => {
    setSubject(todo.subject);
    setUrgent(todo.urgent ?? false);
    setImportant(todo.important ?? false);
    setStatus(todo.status || 'new');
    setEtsDateTime(formatLocalDateTime(todo.etsDateTime));
    setEtaDateTime(formatLocalDateTime(todo.etaDateTime));
    setRemarks(todo.remarks?.content || '');
    setRemarksMarkdown(!todo.remarks || todo.remarks.type === 'markdown');
    setChecklist(todo.checklist || []);
    setCategories(todo.categories || []);
    setError(null);
    setEditing(false);
  }, [todo]);

  const handleEsc = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (editing && !isSubmitting) {
      handleCancelEdit();
    } else if (!editing) {
      onClose();
    }
  }, [editing, isSubmitting, onClose, handleCancelEdit]);

  const dialogRef = useModalDialog<HTMLDivElement>(true, editing);
  const bumpedFrom = describeDateBump(todo);

  useEffect(() => {
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [handleEsc]);

  if (editing) {
    return (
      <div className={styles.overlay} onClick={onClose}>
        <div
          ref={dialogRef}
          className={styles.modal}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="todo-dialog-title"
          tabIndex={-1}
        >
          <h2 id="todo-dialog-title" className={styles.title}>Edit TODO Item</h2>

          {error && (
            <div className={styles.error} role="alert">{error}</div>
          )}

          <form onSubmit={handleSave} className={styles.form}>
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

                <div className={styles.preview}>
                  <p className={styles.previewText}>
                    Matrix Quadrant:{' '}
                    <span className={styles.previewLabel}>{getQuadrantLabel(urgent, important)}</span>
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
                  textareaId="edit-remarks"
                  value={remarks}
                  onChange={setRemarks}
                  disabled={isSubmitting}
                  isMarkdown={remarksMarkdown}
                  onIsMarkdownChange={
                    todo.remarks && todo.remarks.type !== 'markdown' ? setRemarksMarkdown : undefined
                  }
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
                    showCheckboxes
                    showRemoveButton
                    showAddInput
                  />
                </div>
              </div>
            )}

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
      <div
        ref={dialogRef}
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="todo-dialog-title"
        tabIndex={-1}
      >
        <h2 id="todo-dialog-title" className={styles.title}>{todo.subject}</h2>

        {error && (
          <div className={styles.error} role="alert">{error}</div>
        )}

        <div className={styles.form}>
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

              {bumpedFrom && (
                <div className={styles.formGroup}>
                  <span className={styles.label}>Originally planned</span>
                  <span className={styles.value} title={bumpedFrom.tooltip}>
                    {[todo.originalEtsDateTime, todo.originalEtaDateTime]
                      .filter(Boolean)
                      .map(value => formatDateTime(value as string))
                      .join(' → ')}
                  </span>
                  <span className={styles.hint}>
                    Arrange moved these dates forward so the task stays in view.
                  </span>
                </div>
              )}

              <div className={styles.preview}>
                <p className={styles.previewText}>
                  Matrix Quadrant:{' '}
                  <span className={styles.previewLabel}>{getQuadrantLabel(todo.urgent ?? false, todo.important ?? false)}</span>
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
              {todo.categories && todo.categories.length > 0 ? (
                <div className={styles.formGroup}>
                  <span className={styles.label}>Tags</span>
                  <div className={styles.categoryChips}>
                    {todo.categories.map((cat) => (
                      <span key={cat} className={`${styles.categoryChip} ${styles.categoryChipStatic}`}>
                        {cat}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <p className={styles.tabPlaceholder}>No tags</p>
              )}
            </div>
          )}

          {activeTab === 'remarks' && (
            <div
              className={styles.tabContent}
              role="tabpanel"
              id={tabPanelElementId(tabsId, 'remarks')}
              aria-labelledby={tabElementId(tabsId, 'remarks')}
            >
              {todo.remarks?.content ? (
                <div className={styles.formGroupFill}>
                  <span className={styles.label}>Remarks</span>
                  {todo.remarks.type === 'markdown' ? (
                    <MarkdownView content={todo.remarks.content} className={styles.remarksBox} />
                  ) : (
                    <div className={styles.remarksBox}>{todo.remarks.content}</div>
                  )}
                </div>
              ) : (
                <p className={styles.tabPlaceholder}>No remarks</p>
              )}
            </div>
          )}

          {activeTab === 'checklist' && (
            <div
              className={styles.tabContent}
              role="tabpanel"
              id={tabPanelElementId(tabsId, 'checklist')}
              aria-labelledby={tabElementId(tabsId, 'checklist')}
            >
              {displayChecklist && displayChecklist.length > 0 ? (
                <div className={styles.formGroup}>
                  <span className={styles.label}>Checklist</span>
                  <ChecklistEditor
                    items={displayChecklist}
                    onChange={async (updated) => {
                      setViewChecklist(updated);
                      setChecklistUpdating(true);
                      setError(null);
                      try {
                        await onUpdate?.({ checklist: updated });
                      } catch (err: unknown) {
                        setViewChecklist(null);
                        const message = err instanceof Error ? err.message : 'Failed to update checklist';
                        setError(message);
                      } finally {
                        setChecklistUpdating(false);
                      }
                    }}
                    disabled={!onUpdate || checklistUpdating}
                    showCheckboxes
                  />
                </div>
              ) : (
                <p className={styles.tabPlaceholder}>No checklist items</p>
              )}
            </div>
          )}

          <div className={styles.actions}>
            {todo.source && (
              <a
                href={todo.source.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`${styles.button} ${styles.buttonSecondary} ${styles.sourceLink}`}
              >
                {todo.source.label}
              </a>
            )}
            {onUpdate && (
              <button type="button"
                onClick={() => { setChecklist(displayChecklist || []); setEditing(true); }}
                disabled={checklistUpdating}
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
