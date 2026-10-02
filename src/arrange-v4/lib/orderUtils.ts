import type { TodoItemWithId } from '@/lib/store/types';

export type OrderField = 'matrixOrder' | 'scrumOrder';

const ORDER_STEP = 1024;

export function sortByPersistedOrder(
  items: TodoItemWithId[],
  field: OrderField,
  fallbackCompare: (a: TodoItemWithId, b: TodoItemWithId) => number,
): TodoItemWithId[] {
  // Half a step below the saved positions, which are always whole steps: an
  // item with no saved order can then never tie one that has it, so where it
  // lands does not depend on the order the backend happened to return.
  const fallbackRank = new Map(
    items
      .filter(item => {
        const order = item[field];
        return typeof order !== 'number' || !Number.isFinite(order);
      })
      .sort(fallbackCompare)
      .map((item, index) => [item.id, (index + 1) * ORDER_STEP - ORDER_STEP / 2]),
  );

  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const aOrder = a.item[field];
      const bOrder = b.item[field];
      const aRank = typeof aOrder === 'number' && Number.isFinite(aOrder)
        ? aOrder
        : fallbackRank.get(a.item.id) ?? 0;
      const bRank = typeof bOrder === 'number' && Number.isFinite(bOrder)
        ? bOrder
        : fallbackRank.get(b.item.id) ?? 0;
      if (aRank !== bRank) return aRank - bRank;

      const fallback = fallbackCompare(a.item, b.item);
      return fallback !== 0 ? fallback : a.index - b.index;
    })
    .map(({ item }) => item);
}

export function reorderVisibleItems(
  fullItems: TodoItemWithId[],
  visibleIds: Set<string>,
  activeId: string,
  overId: string,
): TodoItemWithId[] {
  const visible = fullItems.filter(item => visibleIds.has(item.id));
  const oldIndex = visible.findIndex(item => item.id === activeId);
  const newIndex = visible.findIndex(item => item.id === overId);
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return fullItems;

  const reorderedVisible = [...visible];
  const [moved] = reorderedVisible.splice(oldIndex, 1);
  reorderedVisible.splice(newIndex, 0, moved);

  let visibleIndex = 0;
  return fullItems.map(item => (
    visibleIds.has(item.id) ? reorderedVisible[visibleIndex++] : item
  ));
}

export function moveBetweenContainers(
  sourceItems: TodoItemWithId[],
  destinationItems: TodoItemWithId[],
  activeId: string,
  overId?: string,
  insertAfter = false,
): { source: TodoItemWithId[]; destination: TodoItemWithId[] } {
  const source = [...sourceItems];
  const activeIndex = source.findIndex(item => item.id === activeId);
  if (activeIndex < 0) return { source: sourceItems, destination: destinationItems };

  const [moved] = source.splice(activeIndex, 1);
  const destination = [...destinationItems];
  const overIndex = overId ? destination.findIndex(item => item.id === overId) : -1;
  const insertionIndex = overIndex >= 0 ? overIndex + (insertAfter ? 1 : 0) : destination.length;
  destination.splice(insertionIndex, 0, moved);
  return { source, destination };
}

export function normalizeOrder(
  items: TodoItemWithId[],
  field: OrderField,
): { items: TodoItemWithId[]; changed: TodoItemWithId[] } {
  const changed: TodoItemWithId[] = [];
  const normalized = items.map((item, index) => {
    const order = (index + 1) * ORDER_STEP;
    if (item[field] === order) return item;
    const updated = { ...item, [field]: order };
    changed.push(updated);
    return updated;
  });
  return { items: normalized, changed };
}

/**
 * Puts back the saved order of any item the stores refuse to write.
 *
 * An item whose payload could not be read is left out of the write, so showing
 * it at its new position would be a lie the next read undoes. Keeping the saved
 * value means the board shows straight away what a refresh would show.
 */
export function keepStoredOrder(
  replacements: TodoItemWithId[],
  items: readonly TodoItemWithId[],
  field: OrderField,
): TodoItemWithId[] {
  const stored = new Map(items.map(item => [item.id, item]));
  return replacements.map(item => {
    const original = stored.get(item.id);
    if (!original?.dataUnreadable || original[field] === item[field]) return item;
    return { ...item, [field]: original[field] };
  });
}

export function replaceItems(
  allItems: TodoItemWithId[],
  replacements: TodoItemWithId[],
): TodoItemWithId[] {
  const byId = new Map(replacements.map(item => [item.id, item]));
  return allItems.map(item => byId.get(item.id) ?? item);
}

export function nextOrder(items: TodoItemWithId[], field: OrderField): number {
  const maxPersisted = items.reduce((max, item) => {
    const order = item[field];
    return typeof order === 'number' && Number.isFinite(order) ? Math.max(max, order) : max;
  }, 0);
  return Math.max(maxPersisted, (items.length + 1) * ORDER_STEP) + ORDER_STEP;
}
