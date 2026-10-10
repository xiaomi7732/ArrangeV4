import type { CreateItemOptions, TodoItem, TodoItemWithId } from './types';

/**
 * The slice of the store a move needs. Narrow on purpose so the logic can be
 * exercised without a backend.
 */
export interface MoveCapableStore {
  createItem(
    bookId: string,
    item: TodoItem,
    options?: CreateItemOptions,
  ): Promise<TodoItemWithId>;
  deleteItem(bookId: string, itemId: string): Promise<void>;
}

export interface MoveItemRequest {
  fromBookId: string;
  toBookId: string;
  item: TodoItemWithId;
}

/**
 * Raised when the copy landed but the original could not be removed, so the
 * item now exists in both books.
 *
 * Callers must not offer a plain retry after this: running the move again
 * would make a second copy. `createdId` identifies the copy that did land.
 */
export class PartialMoveError extends Error {
  readonly createdId: string;

  constructor(message: string, createdId: string) {
    super(message);
    this.name = 'PartialMoveError';
    this.createdId = createdId;
  }
}

/**
 * The payload written into the destination book.
 *
 * Board positions are dropped: they order an item against its siblings, and
 * the siblings are different in the new book. Everything else the user has is
 * carried over verbatim, including the legacy pre-bump dates, which the
 * destination folds back into the planned dates.
 */
export function itemForMove(item: TodoItemWithId): TodoItem {
  const {
    id: _id,
    source: _source,
    matrixOrder: _matrixOrder,
    scrumOrder: _scrumOrder,
    ...rest
  } = item;
  void _id;
  void _source;
  void _matrixOrder;
  void _scrumOrder;
  return rest;
}

/**
 * Moves a TODO item to another book.
 *
 * Backends have no move primitive — a book is a calendar or a spreadsheet —
 * so this is a copy followed by a delete. The copy goes first on purpose: if
 * the second half fails the user is left with a duplicate, which they can see
 * and clean up, rather than with nothing at all.
 */
export async function moveItemToBook(
  store: MoveCapableStore,
  { fromBookId, toBookId, item }: MoveItemRequest,
): Promise<TodoItemWithId> {
  if (!toBookId || toBookId === fromBookId) {
    throw new Error('Pick a different book to move this item to.');
  }
  if (item.dataUnreadable) {
    throw new Error(
      'This item cannot be moved while part of its saved data cannot be read, because the move would drop that data.',
    );
  }

  // `asCopy` keeps the destination from applying new-task defaults: the item
  // already has a history, and a moved item must not be stamped as started or
  // finished at the moment it was moved.
  const created = await store.createItem(toBookId, itemForMove(item), { asCopy: true });

  try {
    await store.deleteItem(fromBookId, item.id);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new PartialMoveError(
      `The item was copied to the other book but could not be removed from this one (${reason}). It now exists in both — delete whichever copy you do not want.`,
      created.id,
    );
  }

  return created;
}
