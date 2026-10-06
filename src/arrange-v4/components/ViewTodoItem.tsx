'use client';

import { useState, useEffect, useCallback, useId, useMemo, useRef } from 'react';
import { TodoItem, TodoStatus, STATUS_LABELS, type Book } from '@/lib/store/types';
import { PartialMoveError } from '@/lib/store/moveItem';
import { useModalDialog } from '@/lib/hooks/useModalDialog';
import { useDiscardGuard } from '@/lib/hooks/useDiscardGuard';
import { hasUnsavedChanges, type FormSnapshot } from '@/lib/unsavedChanges';
import { formatAbsoluteDateTime } from '@/lib/dateUtils';
import { describeDateBump } from '@/lib/bumpNotice';
import {
  TODO_DIALOG_TABS,
  tabElementId,
  tabPanelElementId,
  type TodoDialogTab,
} from '@/lib/dialogTabs';
import ChecklistEditor from './ChecklistEditor';
import ConfirmDiscardDialog from './ConfirmDiscardDialog';
import DialogTabs from './DialogTabs';
import MarkdownView from './MarkdownView';
import ModalOverlay from './ModalOverlay';
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
  /**
   * Moves this item to another book. Omit it to hide the control; it is also
   * hidden when no other writable book exists or the item cannot be read.
   */
  onMove?: (targetBookId: string) => Promise<void>;
  /**
   * Set once a move copied this item but could not remove the original, so a
   * second attempt would write a third copy. The page owns this: it outlives
   * the dialog, which is unmounted when the user closes it.
   */
  moveBlocked?: boolean;
  /** Books the item can be moved to, including the one it is in. */
  books?: Book[];
  /** The book the item currently lives in, excluded from the move targets. */
  currentBookId?: string | null;
  availableCategories?: string[];
}

type ViewTab = TodoDialogTab;

function formatLocalDateTime(isoString?: string) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ViewTodoItem({ todo, onClose, onUpdate, onMove, moveBlocked = false, books = [], currentBookId = null, availableCategories = [] }: ViewTodoItemProps) {
  const [editing, setEditing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checklistUpdating, setChecklistUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ViewTab>('essentials');
  const [moveTargetId, setMoveTargetId] = useState('');
  const [moving, setMoving] = useState(false);
  const [moveLeftDuplicate, setMoveLeftDuplicate] = useState(false);
  const errorRef = useRef<HTMLDivElement | null>(null);
  const tabsId = useId();
  // Optimistic local state for view-mode checklist (tracks pending changes before server confirms)
  const [viewChecklist, setViewChecklist] = useState<string[] | null>(null);
  const displayChecklist = viewChecklist ?? todo.checklist;

  // Reset optimistic state when the todo changes (different item selected)
  useEffect(() => {
    setViewChecklist(null);
    setMoveTargetId('');
    setMoveLeftDuplicate(false);
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
            // Markdown is whitespace-significant — four leading spaces on the
            // first line are a code block — so the text is stored verbatim.
            content: remarksMarkdown ? remarks : remarks.trim(),
          }
        : null;
      const nextChecklist = checklist.length > 0 ? checklist : [];
      const nextCategories = categories.length > 0 ? categories : [];
      const sameValue = (left: unknown, right: unknown) =>
        JSON.stringify(left) === JSON.stringify(right);

      if (nextSubject !== todo.subject) updatedFields.subject = nextSubject;
      if (urgent !== (todo.urgent ?? false)) updatedFields.urgent = urgent;
      if (important !== (todo.important ?? false)) updatedFields.important = important;
      if (status !== (todo.status || 'new')) updatedFields.status = status;
      if (etsDateTime !== formatLocalDateTime(todo.etsDateTime)) {
        updatedFields.etsDateTime = nextEts;
      }
      if (etaDateTime !== formatLocalDateTime(todo.etaDateTime)) {
        updatedFields.etaDateTime = nextEta;
      }
      // Compared untrimmed: saving an unrelated field must not quietly rewrite
      // a remark the user never touched.
      const remarksChanged =
        remarks !== (todo.remarks?.content || '') ||
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

  // The same values `handleCancelEdit` restores, which is exactly what closing
  // the editor would throw away.
  const baselineValues = useMemo(() => ({
    // Trimmed on both sides: the save stores a trimmed subject, so trailing
    // spaces are not a change worth warning about.
    subject: todo.subject.trim(),
    urgent: todo.urgent ?? false,
    important: todo.important ?? false,
    status: todo.status || 'new',
    etsDateTime: formatLocalDateTime(todo.etsDateTime),
    etaDateTime: formatLocalDateTime(todo.etaDateTime),
    remarks: todo.remarks?.content || '',
    // Only meaningful while there is a remark to format: the save ignores a
    // type change on an empty remark, so reporting one as unsaved would nag
    // about something that could never be stored.
    remarksMarkdown: (todo.remarks?.content || '').trim()
      ? (!todo.remarks || todo.remarks.type === 'markdown')
      : null,
    checklist: todo.checklist || [],
    categories: todo.categories || [],
  }), [todo]);

  const dirty = useMemo(
    () => editing && hasUnsavedChanges(
      {
        subject: subject.trim(),
        urgent,
        important,
        status,
        etsDateTime,
        etaDateTime,
        remarks,
        remarksMarkdown: remarks.trim() ? remarksMarkdown : null,
        checklist,
        categories,
      } as FormSnapshot,
      baselineValues as FormSnapshot,
    ),
    [
      editing,
      subject,
      urgent,
      important,
      status,
      etsDateTime,
      etaDateTime,
      remarks,
      remarksMarkdown,
      checklist,
      categories,
      baselineValues,
    ],
  );

  /*
   * Leaving the editor means two different things depending on how it is done:
   * Cancel and Escape drop back to the read-only view, while clicking the
   * overlay closes the dialog outright. Both lose the edits, so both go
   * through the one guard, which remembers which was asked for.
   */
  const pendingDiscardRef = useRef<() => void>(() => {});
  const runPendingDiscard = useCallback(() => {
    pendingDiscardRef.current();
  }, []);

  const { confirming, requestClose, confirmDiscard, cancelDiscard } = useDiscardGuard({
    dirty,
    busy: isSubmitting,
    onDiscard: runPendingDiscard,
  });

  const requestCancelEdit = useCallback(() => {
    pendingDiscardRef.current = handleCancelEdit;
    requestClose();
  }, [handleCancelEdit, requestClose]);

  const requestCloseDialog = useCallback(() => {
    pendingDiscardRef.current = onClose;
    requestClose();
  }, [onClose, requestClose]);

  const handleEsc = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    // The discard prompt claims Escape for itself while it is up.
    if (confirming) return;
    // A move in flight has to be able to report back, including the warning
    // that the item now exists in both books, so the dialog stays put.
    if (moving) return;
    if (editing) {
      requestCancelEdit();
    } else {
      onClose();
    }
  }, [editing, confirming, moving, onClose, requestCancelEdit]);

  const dialogRef = useModalDialog<HTMLDivElement>(true, editing, { paused: confirming });
  const bumpedFrom = describeDateBump(todo);

  // Books the backend refuses to write to are no destination, and an item in
  // one cannot be moved out either: the copy would land and the delete would
  // be refused, leaving a guaranteed duplicate.
  const currentBookWritable = books.every(
    book => book.id !== currentBookId || book.canEdit !== false,
  );
  const moveTargets = useMemo(
    () => books.filter(book => book.id !== currentBookId && book.canEdit !== false),
    [books, currentBookId],
  );
  // An unreadable item is shown with defaults, so copying it into another book
  // would write those defaults over data the backend still holds.
  const canMove = Boolean(onMove)
    && !todo.dataUnreadable
    && currentBookWritable
    && moveTargets.length > 0
    // A move that copied but could not delete must not be repeated: a second
    // run would make a second copy. The warning stays on screen instead.
    && !moveLeftDuplicate
    && !moveBlocked;

  const handleMove = useCallback(async () => {
    if (!onMove || !moveTargetId) return;
    setMoving(true);
    setError(null);
    try {
      await onMove(moveTargetId);
    } catch (err: unknown) {
      if (err instanceof PartialMoveError) setMoveLeftDuplicate(true);
      setError(err instanceof Error ? err.message : 'Failed to move this item');
      // The Move button is disabled or gone by now, so focus would be left on
      // nothing: send it to the message that explains what happened.
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setMoving(false);
    }
  }, [onMove, moveTargetId]);

  useEffect(() => {
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [handleEsc]);

  if (editing) {
    return (
      <ModalOverlay className={styles.overlay} onDismiss={confirming ? undefined : requestCloseDialog}>
        <div
          ref={dialogRef}
          className={styles.modal}
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
              <button type="button" onClick={requestCancelEdit} disabled={isSubmitting}
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

        {confirming && (
          <ConfirmDiscardDialog
            subject="this TODO item"
            onKeepEditing={cancelDiscard}
            onDiscard={confirmDiscard}
          />
        )}
      </ModalOverlay>
    );
  }

  return (
    <ModalOverlay className={styles.overlay} onDismiss={moving ? undefined : onClose}>
      <div
        ref={dialogRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="todo-dialog-title"
        tabIndex={-1}
      >
        <h2 id="todo-dialog-title" className={styles.title}>{todo.subject}</h2>

        {error && (
          <div className={styles.error} role="alert" tabIndex={-1} ref={errorRef}>{error}</div>
        )}

        {!canMove && (moveBlocked || moveLeftDuplicate) && (
          <p className={styles.moveNotice}>
            This item was copied to another book but could not be removed from this one.
            Delete whichever copy you do not want before moving it again.
          </p>
        )}

        {todo.dataUnreadable && (
          <div className={styles.warning} role="status">
            Some of this item&apos;s saved data could not be read, so status, flags,
            checklist and remarks are shown as defaults. The saved data is still
            there — editing is disabled so it cannot be overwritten. Open the
            event in Outlook to repair or clear its description.
          </div>
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
                    disabled={!onUpdate || checklistUpdating || moving}
                    showCheckboxes
                  />
                </div>
              ) : (
                <p className={styles.tabPlaceholder}>No checklist items</p>
              )}
            </div>
          )}

          {canMove && (
            <div className={styles.moveRow}>
              <label className={styles.label} htmlFor={`${tabsId}-move-target`}>
                Move to another book
              </label>
              <div className={styles.moveControls}>
                <select
                  id={`${tabsId}-move-target`}
                  className={styles.select}
                  value={moveTargetId}
                  onChange={e => setMoveTargetId(e.target.value)}
                  disabled={moving}
                >
                  <option value="">Choose a book…</option>
                  {moveTargets.map(book => (
                    <option key={book.id} value={book.id}>{book.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleMove}
                  disabled={!moveTargetId || moving || checklistUpdating}
                  className={`${styles.button} ${styles.buttonSecondary}`}
                >
                  {moving ? 'Moving…' : 'Move'}
                </button>
              </div>
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
                disabled={checklistUpdating || moving || todo.dataUnreadable}
                title={todo.dataUnreadable
                  ? 'Editing is disabled while this item\u2019s saved data cannot be read'
                  : moving
                    ? 'Editing is disabled while this item is being moved'
                    : undefined}
                className={`${styles.button} ${styles.buttonPrimary}`}>
                Edit
              </button>
            )}
            <button type="button" onClick={onClose} disabled={moving}
              className={`${styles.button} ${styles.buttonSecondary}`}>
              Close
            </button>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}
