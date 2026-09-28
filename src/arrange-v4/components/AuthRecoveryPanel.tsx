'use client';

import { useId } from 'react';
import { getAuthRecoveryContent } from '@/lib/auth/recoveryState';
import styles from './AuthRecoveryPanel.module.css';

interface AuthRecoveryPanelProps {
  busy: boolean;
  error: string | null;
  onLogin: () => Promise<void>;
}

export default function AuthRecoveryPanel({
  busy,
  error,
  onLogin,
}: AuthRecoveryPanelProps) {
  const titleId = useId();
  const content = getAuthRecoveryContent(busy);

  return (
    <section
      className={styles.panel}
      aria-labelledby={titleId}
      aria-live={busy ? 'polite' : undefined}
    >
      <div className={styles.icon} aria-hidden="true">
        {busy ? <span className={styles.spinner} /> : '!'}
      </div>
      <h1 id={titleId} className={styles.title}>{content.title}</h1>
      <p className={styles.message}>{content.message}</p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {content.state === 'signed-out' && (
        <button
          type="button"
          className={styles.button}
          onClick={() => void onLogin()}
        >
          Sign in again
        </button>
      )}
    </section>
  );
}
