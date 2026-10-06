'use client';

import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useStore } from '@/lib/store/useStore';
import { moveItemToBook, PartialMoveError } from '@/lib/store/moveItem';
import type { TodoItemWithId } from '@/lib/store/types';

export interface UseMoveTodoOptions<TSelected extends { id?: string }> {
  /** The book currently on screen, i.e. where the item lives today. */
  bookId: string | null;
  /** The page's item list, which the moved item leaves. */
  setItems: Dispatch<SetStateAction<TodoItemWithId[]>>;
  /** The page's open item, closed when it is the one that moved. */
  setSelected: Dispatch<SetStateAction<TSelected | null>>;
  /** Extra per-page cleanup, such as dropping the item from a checkbox selection. */
  onMoved?: (itemId: string) => void;
  /**
   * Registers the move with the page's write bookkeeping: it has to invalidate
   * reads already in flight — a reply that predates the delete would put the
   * item straight back on screen — and count as a pending mutation so that a
   * refresh waits for the move to settle.
   */
  beginMutation?: () => void;
  /** Settles what `beginMutation` registered, including any deferred refresh. */
  finishMutation?: () => void;
  /** Whether the page is still showing the book the move started in. */
  isCurrentBook?: (bookId: string) => boolean;
}

/**
 * Shared "move this item to another book" action for the task views.
 *
 * The write itself lives in `moveItemToBook`; this hook binds it to the page's
 * store and state so every view moves items the same way. The list is only
 * touched once the move has landed — unlike an edit there is nothing to roll
 * back to, since a failed move leaves the item exactly where it was. Errors
 * are raised to the caller, which shows them next to the control that started
 * the move, with the item still open.
 */
export function useMoveTodo<TSelected extends { id?: string }>(
  options: UseMoveTodoOptions<TSelected>,
) {
  const store = useStore();
  // Items whose copy landed but whose original could not be removed. Moving
  // one again would write a third copy, so the page remembers them for as long
  // as it is open — longer than the dialog, which is unmounted on close.
  const [moveBlockedIds, setMoveBlockedIds] = useState<ReadonlySet<string>>(() => new Set());
  // The pages rebuild these callbacks every render, so they are read through a
  // ref rather than listed as dependencies: the returned action stays stable
  // for the dialog that holds on to it.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const moveBlockedIdsRef = useRef(moveBlockedIds);
  moveBlockedIdsRef.current = moveBlockedIds;

  const moveTodo = useCallback(async (item: TodoItemWithId, targetBookId: string) => {
    const {
      bookId,
      setItems,
      setSelected,
      onMoved,
      beginMutation,
      finishMutation,
      isCurrentBook,
    } = optionsRef.current;
    if (!bookId) throw new Error('No book is selected.');
    if (moveBlockedIdsRef.current.has(item.id)) {
      throw new PartialMoveError(
        'This item was already copied to another book and could not be removed from this one. Delete whichever copy you do not want before moving it again.',
        item.id,
      );
    }
    const operationBookId = bookId;

    beginMutation?.();
    try {
      await moveItemToBook(store, {
        fromBookId: operationBookId,
        toBookId: targetBookId,
        item,
      });
      // The page may have moved on to another book while the write was in
      // flight; that board's list has nothing to do with this move.
      if (isCurrentBook && !isCurrentBook(operationBookId)) return;
      setItems(items => items.filter(existing => existing.id !== item.id));
      setSelected(selected => (selected && selected.id === item.id ? null : selected));
      onMoved?.(item.id);
    } catch (error) {
      if (error instanceof PartialMoveError) {
        setMoveBlockedIds(previous => {
          const next = new Set(previous);
          next.add(item.id);
          return next;
        });
      }
      throw error;
    } finally {
      finishMutation?.();
    }
  }, [store]);

  return { moveTodo, moveBlockedIds };
}
