'use client';

import { useCallback, useState } from 'react';
import { resolveCloseIntent } from '@/lib/unsavedChanges';

export interface DiscardGuardOptions {
  /** Whether the form currently holds edits that closing would throw away. */
  dirty: boolean;
  /** Suppresses close requests while a save is in flight. */
  busy?: boolean;
  /** Closes the dialog and drops the edits. Called once the user has agreed. */
  onDiscard: () => void;
}

export interface DiscardGuard {
  /** True while the "discard your changes?" prompt is up. */
  confirming: boolean;
  /**
   * Entry point for every way of leaving the dialog — Cancel, Escape, the
   * overlay, the X. Closes straight away when there is nothing to lose.
   */
  requestClose: () => void;
  /** The user chose to lose the edits. */
  confirmDiscard: () => void;
  /** The user chose to keep editing. */
  cancelDiscard: () => void;
}

/**
 * Guards a dialog's close paths behind a confirmation, but only once the user
 * has actually typed something.
 *
 * Centralized so every editor in the app behaves the same way: the issue asks
 * for a pattern, not a one-off fix, and a prompt that appears in some dialogs
 * and not others is worse than none, because the user stops expecting it.
 */
export function useDiscardGuard({ dirty, busy = false, onDiscard }: DiscardGuardOptions): DiscardGuard {
  const [confirmRequested, setConfirmRequested] = useState(false);

  // A save that lands while the prompt is up has already resolved the question,
  // and an edit the user undid by hand makes the prompt a lie. Deriving the
  // prompt from `dirty` rather than latching it means it simply stops being
  // shown, with no effect needed to chase the change.
  const confirming = confirmRequested && dirty;

  // The request is dropped as soon as there is nothing to lose, so a later edit
  // cannot revive a prompt the user never asked for a second time. This is the
  // documented way to adjust state from a change, and costs no extra commit.
  if (confirmRequested && !dirty) setConfirmRequested(false);

  const requestClose = useCallback(() => {
    const intent = resolveCloseIntent({ dirty, busy });
    if (intent === 'ignore') return;
    if (intent === 'confirm') {
      setConfirmRequested(true);
      return;
    }
    onDiscard();
  }, [dirty, busy, onDiscard]);

  const confirmDiscard = useCallback(() => {
    setConfirmRequested(false);
    onDiscard();
  }, [onDiscard]);

  const cancelDiscard = useCallback(() => setConfirmRequested(false), []);

  return { confirming, requestClose, confirmDiscard, cancelDiscard };
}
