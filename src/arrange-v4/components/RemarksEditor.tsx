'use client';

import { useCallback, useId, useRef, useState } from 'react';
import { tabElementId, tabPanelElementId, type DialogTabDefinition } from '@/lib/dialogTabs';
import DialogTabs from './DialogTabs';
import MarkdownView from './MarkdownView';
import styles from './AddTodoItem.module.css';

type RemarksMode = 'write' | 'preview';

const REMARKS_MODES: readonly DialogTabDefinition<RemarksMode>[] = [
  { id: 'write', label: 'Write' },
  { id: 'preview', label: 'Preview' },
];

interface RemarksEditorProps {
  /** Element id for the textarea, so the owning dialog can label it. */
  textareaId: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Whether this remark is stored as Markdown. */
  isMarkdown: boolean;
  /**
   * Offered for a legacy plain-text remark so the user can opt it in. Omit to
   * hide the control, e.g. when creating a remark that is Markdown anyway.
   */
  onIsMarkdownChange?: (isMarkdown: boolean) => void;
}

/**
 * The Remarks editing surface, with a Write/Preview pair for Markdown.
 *
 * The pair is nested inside the Remarks tab rather than added to the dialog's
 * top-level strip: a preview is meaningless while you are on Essentials, and
 * the strip already scrolls on a phone.
 *
 * Both panels stay mounted and are swapped with CSS so that switching back to
 * Write keeps the caret and scroll position the user left behind.
 */
export default function RemarksEditor({
  textareaId,
  value,
  onChange,
  disabled = false,
  isMarkdown,
  onIsMarkdownChange,
}: RemarksEditorProps) {
  const [mode, setMode] = useState<RemarksMode>('write');
  const modesId = useId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const caretRef = useRef<{ start: number; end: number; scrollTop: number } | null>(null);

  const rememberCaret = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    caretRef.current = {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
      scrollTop: textarea.scrollTop,
    };
  }, []);

  const handleModeChange = useCallback(
    (next: RemarksMode) => {
      if (next === 'preview') rememberCaret();
      setMode(next);
      if (next !== 'write') return;
      // Restore after the panel is visible again; a hidden textarea cannot
      // take focus or be scrolled.
      requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        const caret = caretRef.current;
        if (!textarea) return;
        textarea.focus();
        if (!caret) return;
        textarea.setSelectionRange(caret.start, caret.end);
        textarea.scrollTop = caret.scrollTop;
      });
    },
    [rememberCaret],
  );

  const previewing = isMarkdown && mode === 'preview';

  return (
    <div className={styles.formGroupFill}>
      <div className={styles.remarksHeader}>
        <label htmlFor={textareaId} className={styles.label}>Remarks</label>
        {isMarkdown && (
          <DialogTabs
            tabs={REMARKS_MODES}
            activeTab={mode}
            onChange={handleModeChange}
            idPrefix={modesId}
            ariaLabel="Remarks editing mode"
            className={styles.subTabBar}
            tabClassName={styles.subTab}
            activeTabClassName={styles.subTabActive}
          />
        )}
      </div>

      <div
        className={previewing ? styles.hiddenPanel : styles.remarksPanel}
        {...(isMarkdown
          ? {
              role: 'tabpanel',
              id: tabPanelElementId(modesId, 'write'),
              'aria-labelledby': tabElementId(modesId, 'write'),
            }
          : {})}
      >
        <textarea
          ref={textareaRef}
          id={textareaId}
          value={value}
          onChange={e => onChange(e.target.value)}
          onBlur={rememberCaret}
          placeholder={isMarkdown ? 'Add any notes or remarks… Markdown supported.' : 'Add any notes or remarks...'}
          disabled={disabled}
          className={styles.textarea}
        />
      </div>

      {isMarkdown && (
        <div
          className={previewing ? styles.remarksPanel : styles.hiddenPanel}
          role="tabpanel"
          id={tabPanelElementId(modesId, 'preview')}
          aria-labelledby={tabElementId(modesId, 'preview')}
        >
          {value.trim() ? (
            // Same renderer as the saved view, so the preview cannot promise
            // something the saved note would not show.
            <MarkdownView content={value} className={styles.remarksBox} />
          ) : (
            <p className={styles.remarksEmpty}>Nothing to preview</p>
          )}
        </div>
      )}

      {onIsMarkdownChange && (
        <label className={styles.remarksToggle}>
          <input
            type="checkbox"
            checked={isMarkdown}
            onChange={e => onIsMarkdownChange(e.target.checked)}
            disabled={disabled}
            className={styles.checkbox}
          />
          <span className={styles.checkboxText}>Render as Markdown</span>
        </label>
      )}
    </div>
  );
}
