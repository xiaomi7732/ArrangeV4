import { useEffect, useRef } from 'react';

export interface PointerDismissState {
  /** The pointer landed inside the panel itself. */
  insidePanel: boolean;
  /** The pointer landed on the trigger, which does its own toggling. */
  insideTrigger: boolean;
}

/** Escape is the one key that closes a disclosure panel. */
export function shouldDismissOnKey(key: string): boolean {
  return key === 'Escape';
}

/**
 * A pointer press dismisses the panel only when it is genuinely outside it.
 *
 * Presses on the trigger are excluded because the trigger already toggles the
 * panel; dismissing here too would close and immediately reopen it.
 */
export function shouldDismissOnPointer({
  insidePanel,
  insideTrigger,
}: PointerDismissState): boolean {
  return !insidePanel && !insideTrigger;
}

/**
 * Picks which of the currently open panels should handle an Escape press.
 *
 * Every open panel listens on the document, so without this they would all
 * close on one key press and each would try to move focus to its own trigger.
 * The panel containing the focused element owns the key; failing that the most
 * recently opened one does, which is the one the user just interacted with.
 *
 * `owners[i]` says whether open panel `i` contains the event target.
 */
export function selectDismissIndex(owners: readonly boolean[]): number {
  const owner = owners.indexOf(true);
  if (owner !== -1) return owner;
  return owners.length - 1;
}

interface OpenPanel {
  contains: (target: Node | null) => boolean;
  close: () => void;
  focusTrigger: () => void;
}

/** Open panels in the order they were opened; the last is the newest. */
const openPanels: OpenPanel[] = [];

/**
 * Gives a disclosure panel the dismissal behaviour the rest of the app has:
 * Escape closes it and returns focus to its trigger, and (unless opted out) a
 * press anywhere outside closes it. Unmounting on navigation closes it too,
 * since the effect is torn down with the page.
 *
 * Attach `panelRef` to the panel container and `triggerRef` to the button that
 * toggles it. `onClose` must be stable (wrap it in `useCallback`).
 *
 * Set `dismissOnOutsidePress: false` for a panel that is open by default and
 * sits in the page flow, where collapsing on any stray click would fight the
 * user instead of helping.
 */
export function useDismissiblePanel<P extends HTMLElement, T extends HTMLElement>(
  isOpen: boolean,
  onClose: () => void,
  { dismissOnOutsidePress = true }: { dismissOnOutsidePress?: boolean } = {},
) {
  const panelRef = useRef<P | null>(null);
  const triggerRef = useRef<T | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    // A modal dialog owns Escape while it is open, and stealing focus back to
    // our trigger would pull the user out of it.
    const modalIsOpen = () => document.querySelector('[role="dialog"]') !== null;

    const entry: OpenPanel = {
      contains: target =>
        target !== null
        && (panelRef.current?.contains(target) === true
          || triggerRef.current?.contains(target) === true),
      close: onClose,
      focusTrigger: () => triggerRef.current?.focus(),
    };
    openPanels.push(entry);

    const onKeyDown = (event: KeyboardEvent) => {
      if (!shouldDismissOnKey(event.key)) return;
      if (modalIsOpen()) return;
      const target = event.target as Node | null;
      // Every open panel sees this event; only one of them may act on it.
      if (openPanels[selectDismissIndex(openPanels.map(p => p.contains(target)))] !== entry) {
        return;
      }
      entry.close();
      entry.focusTrigger();
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      const dismiss = shouldDismissOnPointer({
        insidePanel: target !== null && panelRef.current?.contains(target) === true,
        insideTrigger: target !== null && triggerRef.current?.contains(target) === true,
      });
      if (dismiss) onClose();
    };

    document.addEventListener('keydown', onKeyDown);
    if (dismissOnOutsidePress) {
      document.addEventListener('pointerdown', onPointerDown);
    }
    return () => {
      const index = openPanels.indexOf(entry);
      if (index !== -1) openPanels.splice(index, 1);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [isOpen, onClose, dismissOnOutsidePress]);

  return { panelRef, triggerRef };
}
