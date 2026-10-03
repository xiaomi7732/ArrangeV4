/**
 * Checklist entries are stored as one line each, `-[] text` or `-[x] text`.
 *
 * The marker was parsed and rebuilt in four places with three slightly
 * different regexes, so the shape lives here now. The text after the marker is
 * Markdown — a checklist item is a one-liner, so it is always rendered inline.
 */
export interface ChecklistEntry {
  checked: boolean;
  /** The Markdown source of the item, without the stored marker. */
  text: string;
}

const MARKER = /^-\[([xX]?)\]\s*/;

export function parseChecklistEntry(entry: string): ChecklistEntry {
  const match = MARKER.exec(entry);
  if (!match) return { checked: false, text: entry };
  return { checked: match[1].toLowerCase() === 'x', text: entry.slice(match[0].length) };
}

export function formatChecklistEntry(checked: boolean, text: string): string {
  return `${checked ? '-[x]' : '-[]'} ${text}`;
}

/** The Markdown source of an entry, with its stored marker removed. */
export function checklistEntryText(entry: string): string {
  return parseChecklistEntry(entry).text;
}

export function toggleChecklistEntry(entry: string): string {
  const { checked, text } = parseChecklistEntry(entry);
  return formatChecklistEntry(!checked, text);
}

/** How many entries are ticked, for the card summary. */
export function countCheckedEntries(entries: readonly string[]): number {
  return entries.reduce((total, entry) => total + (parseChecklistEntry(entry).checked ? 1 : 0), 0);
}
