'use client';

import { useRef } from 'react';
import {
  nextTabIndex,
  tabElementId,
  tabPanelElementId,
  type DialogTabDefinition,
} from '@/lib/dialogTabs';

interface DialogTabsProps<T extends string> {
  tabs: readonly DialogTabDefinition<T>[];
  activeTab: T;
  onChange: (tab: T) => void;
  /** Unique per dialog instance, used to derive tab and panel element ids. */
  idPrefix: string;
  ariaLabel: string;
  className?: string;
  tabClassName?: string;
  activeTabClassName?: string;
}

/**
 * A WAI-ARIA tablist for the TODO dialogs.
 *
 * The strip already looked and behaved like tabs; this gives it the semantics
 * to match — a single tab stop with arrow-key navigation, and an announced
 * selected state instead of colour alone.
 */
export default function DialogTabs<T extends string>({
  tabs,
  activeTab,
  onChange,
  idPrefix,
  ariaLabel,
  className,
  tabClassName = '',
  activeTabClassName = '',
}: DialogTabsProps<T>) {
  const tabRefs = useRef<Map<T, HTMLButtonElement>>(new Map());

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const current = tabs.findIndex(tab => tab.id === activeTab);
    const target = nextTabIndex(current, event.key, tabs.length);
    if (target === null) return;
    event.preventDefault();
    const next = tabs[target];
    onChange(next.id);
    // Selection follows focus, so move focus along with it.
    tabRefs.current.get(next.id)?.focus();
  };

  return (
    <div className={className} role="tablist" aria-label={ariaLabel} onKeyDown={handleKeyDown}>
      {tabs.map(tab => {
        const selected = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={tabElementId(idPrefix, tab.id)}
            aria-selected={selected}
            // Only the selected panel is rendered in the dialogs, so pointing
            // an inactive tab at its panel id would dangle.
            aria-controls={selected ? tabPanelElementId(idPrefix, tab.id) : undefined}
            tabIndex={selected ? 0 : -1}
            ref={node => {
              if (node) tabRefs.current.set(tab.id, node);
              else tabRefs.current.delete(tab.id);
            }}
            className={`${tabClassName} ${selected ? activeTabClassName : ''}`}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
