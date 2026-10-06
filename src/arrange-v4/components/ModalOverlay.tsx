'use client';

import { useRef, type ReactNode } from 'react';
import { shouldDismissOnBackdrop } from '@/lib/modalOverlay';

interface ModalOverlayProps {
  /** Backdrop class from the owning dialog's CSS module. */
  className: string;
  /**
   * Called when the backdrop is clicked. Omit it for dialogs that must be
   * dismissed deliberately, such as a confirmation prompt.
   */
  onDismiss?: () => void;
  children: ReactNode;
}

/**
 * The shared backdrop for the app's modal dialogs, so every dialog dismisses
 * the same way. Children are rendered as-is and do not need to stop click
 * propagation — the backdrop only reacts to presses that are entirely its own.
 */
export default function ModalOverlay({ className, onDismiss, children }: ModalOverlayProps) {
  const pressedOnBackdropRef = useRef(false);

  return (
    <div
      className={className}
      onMouseDown={event => {
        pressedOnBackdropRef.current = event.target === event.currentTarget;
      }}
      onClick={event => {
        const pressedOnBackdrop = pressedOnBackdropRef.current;
        pressedOnBackdropRef.current = false;
        if (!onDismiss) return;
        if (shouldDismissOnBackdrop({
          pressedOnBackdrop,
          releasedOnBackdrop: event.target === event.currentTarget,
        })) {
          onDismiss();
        }
      }}
    >
      {children}
    </div>
  );
}
