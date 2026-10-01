/**
 * Keyboard handling for the WAI-ARIA tabs pattern.
 *
 * Note: this module is compiled by tsconfig.test.json, which does not rewrite
 * the "@/" path alias, so imports here must stay relative.
 */

/**
 * Index the focus should move to for a key pressed inside a tablist, or null
 * when the key is not one the pattern handles and the browser should keep it.
 *
 * Left/Right wrap around; Home/End jump to the ends.
 */
export function nextTabIndex(current: number, key: string, count: number): number | null {
  if (count === 0) return null;

  switch (key) {
    case 'ArrowRight':
      return (current + 1) % count;
    case 'ArrowLeft':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

export function tabElementId(prefix: string, tabId: string): string {
  return `${prefix}-tab-${tabId}`;
}

export function tabPanelElementId(prefix: string, tabId: string): string {
  return `${prefix}-panel-${tabId}`;
}

export interface DialogTabDefinition<T extends string> {
  id: T;
  label: string;
}

export type TodoDialogTab = 'essentials' | 'tags' | 'remarks' | 'checklist';

/** The section strip shared by the add and detail dialogs. */
export const TODO_DIALOG_TABS: readonly DialogTabDefinition<TodoDialogTab>[] = [
  { id: 'essentials', label: 'Essentials' },
  { id: 'tags', label: 'Tags' },
  { id: 'remarks', label: 'Remarks' },
  { id: 'checklist', label: 'Checklist' },
];
