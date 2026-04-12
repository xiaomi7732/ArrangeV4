'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface TopBarContextType {
  actions: ReactNode;
  setActions: (actions: ReactNode) => void;
}

const TopBarContext = createContext<TopBarContextType>({
  actions: null,
  setActions: () => {},
});

/**
 * Hook for pages to inject action buttons into the shared top bar.
 * Call setActions in a useEffect and clean up on unmount.
 */
export function useTopBarActions() {
  return useContext(TopBarContext);
}

/**
 * Convenience hook that sets actions on mount and clears on unmount.
 */
export function useSetTopBarActions(actions: ReactNode, deps: unknown[]) {
  const { setActions } = useTopBarActions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setActions(actions);
    return () => setActions(null);
  }, deps);
}

export function TopBarProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ReactNode>(null);
  return (
    <TopBarContext.Provider value={{ actions, setActions }}>
      {children}
    </TopBarContext.Provider>
  );
}
