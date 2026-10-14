'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface ModalPresenceContextValue {
  /** How many modal dialogs are on screen right now. */
  openCount: number;
  /** Called by a dialog on mount; the returned function retires it. */
  registerModal: () => () => void;
}

const ModalPresenceContext = createContext<ModalPresenceContextValue>({
  openCount: 0,
  registerModal: () => () => {},
});

/**
 * Tells pages whether a modal dialog is on screen.
 *
 * Background work that redraws the page — an activation refresh, say — has to
 * hold off while the user is part-way through a dialog, so this count is kept
 * where any page can read it rather than threading dialog state back up
 * through each one.
 */
export function useModalPresence(): { anyOpen: boolean; openCount: number } {
  const { openCount } = useContext(ModalPresenceContext);
  return { anyOpen: openCount > 0, openCount };
}

/** Registration side of the context, for the shared dialog backdrop. */
export function useModalRegistration(): () => () => void {
  return useContext(ModalPresenceContext).registerModal;
}

export function ModalPresenceProvider({ children }: { children: ReactNode }) {
  const [openCount, setOpenCount] = useState(0);

  // Stable, so a dialog registers once on mount rather than on every render of
  // whatever is above it.
  const registerModal = useCallback(() => {
    setOpenCount(count => count + 1);
    let retired = false;
    return () => {
      if (retired) return;
      retired = true;
      setOpenCount(count => Math.max(0, count - 1));
    };
  }, []);

  const value = useMemo(() => ({ openCount, registerModal }), [openCount, registerModal]);

  return (
    <ModalPresenceContext.Provider value={value}>
      {children}
    </ModalPresenceContext.Provider>
  );
}
