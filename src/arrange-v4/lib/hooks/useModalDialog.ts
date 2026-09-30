import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export interface FocusTrapState {
  /** Focusable elements inside the dialog, in tab order. */
  focusable: readonly string[];
  /** The currently focused element, or null when focus escaped the dialog. */
  active: string | null;
  shiftKey: boolean;
}

/**
 * Resolves where Tab should land to keep focus inside a modal dialog.
 *
 * Returns null when the browser's own behaviour is already correct, so the
 * caller only has to preventDefault on a wrap.
 */
export function nextFocusTarget({ focusable, active, shiftKey }: FocusTrapState): string | null {
  if (focusable.length === 0) return null;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (active === null) return shiftKey ? last : first;
  if (shiftKey && active === first) return last;
  if (!shiftKey && active === last) return first;
  return null;
}

/**
 * Gives a modal dialog the focus behaviour assistive technology expects:
 * focus moves into the dialog on open, Tab cannot leave it, and focus returns
 * to whatever opened it on close.
 *
 * Attach the returned ref to the dialog container, which must carry
 * `tabIndex={-1}` so it can receive the initial focus.
 *
 * Pass `contentKey` when the dialog swaps its container element (for example
 * a view/edit switch) so the trap re-binds to the new node.
 */
export function useModalDialog<T extends HTMLElement>(isOpen: boolean, contentKey?: unknown) {
  const containerRef = useRef<T | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusableElements = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter(el => el.getClientRects().length > 0);

    // Focus the container rather than the first control so screen readers
    // announce the dialog's name and role before its contents.
    container.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const elements = focusableElements();
      if (elements.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const activeElement = document.activeElement as HTMLElement | null;
      const activeIndex = activeElement ? elements.indexOf(activeElement) : -1;
      const inside = activeElement !== null && container.contains(activeElement);
      const target = nextFocusTarget({
        focusable: elements.map((_, index) => String(index)),
        active: inside && activeIndex >= 0 ? String(activeIndex) : null,
        shiftKey: event.shiftKey,
      });
      if (target === null) return;
      event.preventDefault();
      elements[Number(target)].focus();
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [isOpen, contentKey]);

  return containerRef;
}
