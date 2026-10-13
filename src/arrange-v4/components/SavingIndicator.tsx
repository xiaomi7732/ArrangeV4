'use client';

import styles from './SavingIndicator.module.css';

interface SavingIndicatorProps {
  saving: boolean;
}

/**
 * A quiet "Saving…" marker for writes still on their way to the backend.
 *
 * The boards move a card the moment it is dragged and sync afterwards, so
 * without this there is nothing to show that the previous drag has not landed
 * yet. It never blocks: the point is to let a user see the queue draining, not
 * to stop them working while it does.
 */
export default function SavingIndicator({ saving }: SavingIndicatorProps) {
  return (
    <span className={styles.wrapper} role="status" aria-live="polite">
      {saving && (
        <>
          <span className={styles.spinner} aria-hidden="true" />
          <span className={styles.label}>Saving…</span>
        </>
      )}
    </span>
  );
}
