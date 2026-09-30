'use client';

import styles from './ErrorBanner.module.css';

interface ErrorBannerProps {
  message: string;
  /** What the user was doing, e.g. "save your change". Kept plain-language. */
  action?: string;
  onDismiss: () => void;
}

/**
 * A failure notice the user can get rid of.
 *
 * Without a dismiss control a transient failure looks permanent: the banner
 * outlives the condition that caused it and only a successful refresh clears
 * it, so the app looks broken long after it has recovered.
 */
export default function ErrorBanner({ message, action, onDismiss }: ErrorBannerProps) {
  return (
    <div className={styles.error} role="alert">
      <div className={styles.text}>
        <span className={styles.title}>
          {action ? `Couldn't ${action}. ` : 'Something went wrong. '}
        </span>
        <span className={styles.detail}>{message}</span>
      </div>
      <button
        type="button"
        className={styles.dismiss}
        onClick={onDismiss}
        aria-label="Dismiss error"
      >
        ✕
      </button>
    </div>
  );
}
