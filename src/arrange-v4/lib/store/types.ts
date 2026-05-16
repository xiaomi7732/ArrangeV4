/**
 * Storage abstraction layer types.
 *
 * Designed for a single backend today (Calendar) but with the seams for
 * additional backends later. Book IDs are prefixed at the storage boundary
 * (e.g. `cal:<calendarId>`) so the router can dispatch to the right
 * implementation. Item IDs are bare backend IDs since they only exist
 * within the context of a Book.
 */

export type TodoStatus = 'new' | 'inProgress' | 'blocked' | 'finished' | 'cancelled';

export const ALL_STATUSES: TodoStatus[] = ['new', 'inProgress', 'blocked', 'finished', 'cancelled'];

export const STATUS_LABELS: Record<TodoStatus, string> = {
  new: 'New',
  inProgress: 'In Progress',
  blocked: 'Blocked',
  finished: 'Finished',
  cancelled: 'Cancelled',
};

const NON_TERMINAL_STATUSES: TodoStatus[] = ['new', 'inProgress', 'blocked'];

export function isNonTerminalStatus(status: TodoStatus | undefined): boolean {
  return NON_TERMINAL_STATUSES.includes(status || 'new');
}

export type BackendKind = 'calendar';

export interface TodoItem {
  subject: string;
  categories?: string[];
  etsDateTime?: string;
  etaDateTime?: string;
  urgent?: boolean;
  important?: boolean;
  status?: TodoStatus;
  startDateTime?: string | null;
  finishDateTime?: string | null;
  originalEtsDateTime?: string | null;
  originalEtaDateTime?: string | null;
  checklist?: string[];
  remarks?: {
    type: 'text' | 'markdown';
    content: string;
  } | null;
}

export type TodoItemWithId = TodoItem & { id: string };

export interface Book {
  /** Prefixed identifier, e.g. `cal:<calendarId>`. Routing is done off the prefix. */
  id: string;
  /** Display name with any backend-specific suffix already stripped. */
  name: string;
  backend: BackendKind;
  /** Backend-specific metadata follows. Optional because not every backend exposes these. */
  color?: string;
  owner?: { name?: string; address?: string };
  canEdit?: boolean;
  canShare?: boolean;
  canViewPrivateItems?: boolean;
}

export type ListItemsRange = 'all' | 'window';

export interface ListItemsOptions {
  /**
   * Explicit range. No implicit defaults — callers must pick.
   * - 'window' requires `fromDate` and `toDate`.
   * - 'all' ignores date bounds.
   */
  range: ListItemsRange;
  fromDate?: string;
  toDate?: string;
}

export interface CreateBookOptions {
  /**
   * Required even when only one backend exists today, so existing callers
   * are future-proof when additional backends land.
   */
  backend: BackendKind;
}

export interface TodoStore {
  listBooks(): Promise<Book[]>;
  createBook(name: string, opts: CreateBookOptions): Promise<Book>;
  deleteBook(bookId: string): Promise<void>;

  listItems(bookId: string, opts: ListItemsOptions): Promise<TodoItemWithId[]>;
  createItem(bookId: string, item: TodoItem): Promise<TodoItemWithId>;
  updateItem(bookId: string, itemId: string, updates: Partial<TodoItem>): Promise<TodoItemWithId>;
  deleteItem(bookId: string, itemId: string): Promise<void>;
}

/**
 * Token acquisition callback. The store does not import MSAL directly so
 * that future backends with different auth providers can plug in without
 * touching the interface.
 */
export type AcquireToken = () => Promise<string>;

export interface StoreOptions {
  acquireToken: AcquireToken;
}

/* ---- ID prefix helpers ---- */

const PREFIX_SEPARATOR = ':';
const BACKEND_PREFIXES: Record<BackendKind, string> = {
  calendar: 'cal',
};

export function makeBookId(backend: BackendKind, nativeId: string): string {
  return `${BACKEND_PREFIXES[backend]}${PREFIX_SEPARATOR}${nativeId}`;
}

/**
 * Parses a prefixed book ID. Accepts unprefixed values (treated as legacy
 * calendar IDs) so old URLs and localStorage entries from before the
 * abstraction landed keep working.
 */
export function parseBookId(bookId: string): { backend: BackendKind; nativeId: string } | null {
  if (!bookId) return null;

  for (const [backend, prefix] of Object.entries(BACKEND_PREFIXES) as [BackendKind, string][]) {
    const fullPrefix = `${prefix}${PREFIX_SEPARATOR}`;
    if (bookId.startsWith(fullPrefix)) {
      const nativeId = bookId.slice(fullPrefix.length);
      if (!nativeId) return null;
      return { backend, nativeId };
    }
  }

  return { backend: 'calendar', nativeId: bookId };
}

/**
 * Normalizes an ID to its prefixed form. Idempotent.
 * Used at the boundary where untrusted external IDs (URL params, localStorage)
 * enter the system.
 */
export function normalizeBookId(bookId: string | null | undefined): string | null {
  if (!bookId) return null;
  const parsed = parseBookId(bookId);
  if (!parsed) return null;
  return makeBookId(parsed.backend, parsed.nativeId);
}
