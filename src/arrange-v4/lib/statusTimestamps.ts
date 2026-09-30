import { TodoItem, TodoStatus } from './store/types';

type LifecycleFields = Pick<TodoItem, 'status' | 'startDateTime' | 'finishDateTime'>;

/**
 * Lifecycle timestamp changes implied by a status transition.
 *
 * Cleared values are explicit nulls rather than undefined: undefined means
 * "leave this field alone" to the stores, so clearing with it would update the
 * screen while leaving the old timestamp in storage.
 */
export function statusTimestampUpdates(
  todo: LifecycleFields,
  newStatus: TodoStatus,
  now: string,
): Partial<TodoItem> {
  const currentStatus = todo.status || 'new';
  const updates: Partial<TodoItem> = {};

  if (newStatus === 'inProgress' && !todo.startDateTime) {
    updates.startDateTime = now;
  }
  if (newStatus === 'new') {
    // Back to the backlog: the task has not been started after all.
    if (todo.startDateTime) updates.startDateTime = null;
  }
  if (newStatus === 'finished') {
    if (!todo.startDateTime) updates.startDateTime = now;
    if (!todo.finishDateTime) updates.finishDateTime = now;
  }
  if (newStatus !== 'finished' && currentStatus === 'finished' && todo.finishDateTime) {
    updates.finishDateTime = null;
  }

  return updates;
}
