'use client';

import { useEffect, useId } from 'react';
import { useModalDialog } from '@/lib/hooks/useModalDialog';
import styles from './ConfirmDiscardDialog.module.css';

interface ConfirmDiscardDialogProps {
  /** What would be lost, e.g. "this new TODO item". Completes "Discard …?". */
  subject: string;
  onKeepEditing: () => void;
  onDiscard: () => void;
}

/**
 * The shared "you have unsaved edits" prompt.
 *
 * Deliberately one component rather than a per-dialog copy: the wording, the
 * button order, and which button Escape maps to all have to match everywhere,
 * or the muscle memory the user builds in one editor loses their work in
 * another.
 *
 * "Keep editing" is the safe default: it comes first in the tab order, and
 * Escape and an overlay click both map to it, so an absent-minded dismissal
 * returns to the form instead of destroying it.
 */
export default function ConfirmDiscardDialog({
  subject,
  onKeepEditing,
  onDiscard,
}: ConfirmDiscardDialogProps) {
  const titleId = useId();
  const messageId = useId();
  const dialogRef = useModalDialog<HTMLDivElement>(true);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Claimed before the editor underneath can see it: Escape is also how
      // that dialog closes, and letting it through would discard the very
      // changes this prompt exists to protect.
      event.preventDefault();
      event.stopPropagation();
      onKeepEditing();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onKeepEditing]);

  return (
    <div
      className={styles.overlay}
      /*
       * Every click is stopped here, not just the ones on the backdrop. This
       * prompt renders inside the editor it is protecting, and that editor's
       * own overlay closes on click — so a click that escaped would re-ask the
       * question the user just answered, and could swap which close action is
       * pending underneath.
       */
      onClick={e => { e.stopPropagation(); onKeepEditing(); }}
      onMouseDown={e => e.stopPropagation()}
    >
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onClick={e => e.stopPropagation()}
        tabIndex={-1}
      >        <h2 id={titleId} className={styles.title}>Discard unsaved changes?</h2>
        <p id={messageId} className={styles.message}>
          Your edits to {subject} have not been saved. Closing now will lose them.
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            onClick={onKeepEditing}
            className={`${styles.button} ${styles.buttonSecondary}`}
          >
            Keep editing
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className={`${styles.button} ${styles.buttonDanger}`}
          >
            Discard changes
          </button>
        </div>
      </div>
    </div>
  );
}
