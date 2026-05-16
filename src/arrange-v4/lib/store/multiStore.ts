import type {
  Book,
  CreateBookOptions,
  ListItemsOptions,
  StoreOptions,
  TodoItem,
  TodoItemWithId,
  TodoStore,
} from './types';
import { parseBookId } from './types';
import { CalendarStore } from './calendar/CalendarStore';

/**
 * Routes every call to the right backend implementation based on the
 * book ID prefix. Today there's only one backend (Calendar), so this
 * is effectively a pass-through with cheap validation. The structure
 * exists so future backends can plug in without touching consumers.
 */
export class MultiBackendStore implements TodoStore {
  private readonly calendarStore: CalendarStore;

  constructor(opts: StoreOptions) {
    this.calendarStore = new CalendarStore(opts);
  }

  /** Direct access to the calendar-specific store for backend-specific methods (e.g. sweep). */
  get calendar(): CalendarStore {
    return this.calendarStore;
  }

  async listBooks(): Promise<Book[]> {
    // Only one backend today; future versions would merge results from each.
    return this.calendarStore.listBooks();
  }

  createBook(name: string, opts: CreateBookOptions): Promise<Book> {
    return this.routeByBackend(opts.backend).createBook(name, opts);
  }

  deleteBook(bookId: string): Promise<void> {
    return this.routeByBookId(bookId).deleteBook(bookId);
  }

  listItems(bookId: string, opts: ListItemsOptions): Promise<TodoItemWithId[]> {
    return this.routeByBookId(bookId).listItems(bookId, opts);
  }

  createItem(bookId: string, item: TodoItem): Promise<TodoItemWithId> {
    return this.routeByBookId(bookId).createItem(bookId, item);
  }

  updateItem(bookId: string, itemId: string, updates: Partial<TodoItem>): Promise<TodoItemWithId> {
    return this.routeByBookId(bookId).updateItem(bookId, itemId, updates);
  }

  deleteItem(bookId: string, itemId: string): Promise<void> {
    return this.routeByBookId(bookId).deleteItem(bookId, itemId);
  }

  private routeByBookId(bookId: string): TodoStore {
    const parsed = parseBookId(bookId);
    if (!parsed) {
      throw new Error(`Cannot route call: unrecognized book ID "${bookId}".`);
    }
    return this.routeByBackend(parsed.backend);
  }

  private routeByBackend(backend: string): TodoStore {
    switch (backend) {
      case 'calendar':
        return this.calendarStore;
      default:
        throw new Error(`Unsupported backend "${backend}".`);
    }
  }
}
