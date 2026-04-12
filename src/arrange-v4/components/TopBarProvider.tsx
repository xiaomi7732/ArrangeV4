'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface TopBarContextType {
  leftActions: ReactNode;
  setLeftActions: (actions: ReactNode) => void;
  rightActions: ReactNode;
  setRightActions: (actions: ReactNode) => void;
}

const TopBarContext = createContext<TopBarContextType>({
  leftActions: null,
  setLeftActions: () => {},
  rightActions: null,
  setRightActions: () => {},
});

/**
 * Hook for pages to inject action buttons into the shared top bar.
 */
export function useTopBarActions() {
  return useContext(TopBarContext);
}

/**
 * Convenience hook that sets left and right actions on mount and clears on unmount.
 */
export function useSetTopBarActions(
  leftActions: ReactNode,
  rightActions: ReactNode,
  deps: unknown[],
) {
  const { setLeftActions, setRightActions } = useTopBarActions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setLeftActions(leftActions);
    setRightActions(rightActions);
    return () => {
      setLeftActions(null);
      setRightActions(null);
    };
  }, deps);
}

export function TopBarProvider({ children }: { children: ReactNode }) {
  const [leftActions, setLeftActions] = useState<ReactNode>(null);
  const [rightActions, setRightActions] = useState<ReactNode>(null);
  return (
    <TopBarContext.Provider value={{ leftActions, setLeftActions, rightActions, setRightActions }}>
      {children}
    </TopBarContext.Provider>
  );
}
