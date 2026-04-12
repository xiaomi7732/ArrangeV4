'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import SortableChecklistItem from './SortableChecklistItem';
import styles from './AddTodoItem.module.css';

interface ChecklistEditorProps {
  items: string[];
  onChange: (items: string[]) => void;
  disabled?: boolean;
  showCheckboxes?: boolean;
  showRemoveButton?: boolean;
  showAddInput?: boolean;
}

function generateIds(count: number, startFrom: number): string[] {
  return Array.from({ length: count }, (_, i) => `cl-${startFrom + i}`);
}

function reconcileIds(
  newItems: string[],
  oldItems: string[],
  oldIds: string[],
  counter: { current: number },
): string[] {
  if (newItems.length === oldIds.length && newItems === oldItems) {
    return oldIds;
  }
  if (newItems.length === oldIds.length) {
    // Same length — reconcile by matching content
    const usedIndices = new Set<number>();
    const result: string[] = [];
    for (const item of newItems) {
      const matchIdx = oldItems.findIndex((old, i) => old === item && !usedIndices.has(i));
      if (matchIdx >= 0) {
        usedIndices.add(matchIdx);
        result.push(oldIds[matchIdx]);
      } else {
        result.push(`cl-${counter.current++}`);
      }
    }
    return result;
  }
  if (newItems.length > oldIds.length) {
    const added = generateIds(newItems.length - oldIds.length, counter.current);
    counter.current += added.length;
    return [...oldIds, ...added];
  }
  return oldIds.slice(0, newItems.length);
}

export default function ChecklistEditor({
  items,
  onChange,
  disabled = false,
  showCheckboxes = false,
  showRemoveButton = false,
  showAddInput = false,
}: ChecklistEditorProps) {
  const [newChecklistItem, setNewChecklistItem] = useState('');
  const [bulkAddMode, setBulkAddMode] = useState(false);
  const [bulkAddText, setBulkAddText] = useState('');

  // Stable IDs for sortable items
  const nextIdCounter = useRef(items.length);
  const [itemIds, setItemIds] = useState<string[]>(() => generateIds(items.length, 0));
  const prevItemsRef = useRef<string[]>(items);

  // Reconcile IDs on commit when items change externally
  useEffect(() => {
    if (prevItemsRef.current !== items) {
      setItemIds(prev => reconcileIds(items, prevItemsRef.current, prev, nextIdCounter));
      prevItemsRef.current = items;
    }
  }, [items]);

  // Derive render-safe IDs that are always in sync with items.length
  const renderIds = useMemo(() => {
    if (itemIds.length === items.length) return itemIds;
    // Temporarily pad or trim to match items during the render before useEffect fires
    if (items.length > itemIds.length) {
      const padded = [...itemIds];
      for (let i = itemIds.length; i < items.length; i++) {
        padded.push(`cl-tmp-${i}`);
      }
      return padded;
    }
    return itemIds.slice(0, items.length);
  }, [itemIds, items.length]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = renderIds.indexOf(String(active.id));
      const newIndex = renderIds.indexOf(String(over.id));
      if (oldIndex >= 0 && newIndex >= 0) {
        const updatedItems = arrayMove(items, oldIndex, newIndex);
        const updatedIds = arrayMove(renderIds, oldIndex, newIndex);
        prevItemsRef.current = updatedItems;
        setItemIds(updatedIds);
        onChange(updatedItems);
      }
    }
  }, [items, onChange, renderIds]);

  const handleToggle = (idx: number) => {
    const item = items[idx];
    const checked = item.startsWith('-[x]');
    const text = item.replace(/^-\[x?\]\s*/, '');
    const updated = [...items];
    updated[idx] = checked ? '-[] ' + text : '-[x] ' + text;
    prevItemsRef.current = updated;
    onChange(updated);
  };

  const handleRemove = (idx: number) => {
    setItemIds(ids => ids.filter((_, i) => i !== idx));
    const updated = items.filter((_, i) => i !== idx);
    prevItemsRef.current = updated;
    onChange(updated);
  };

  const handleAddSingle = (text: string) => {
    const newId = `cl-${nextIdCounter.current++}`;
    setItemIds(ids => [...ids, newId]);
    const updated = [...items, '-[] ' + text];
    prevItemsRef.current = updated;
    onChange(updated);
  };

  const handleAddBulk = (text: string) => {
    const newItems = text.split('\n').map(l => l.trim()).filter(Boolean).map(l => '-[] ' + l);
    if (newItems.length > 0) {
      const newIds = generateIds(newItems.length, nextIdCounter.current);
      nextIdCounter.current += newIds.length;
      setItemIds(ids => [...ids, ...newIds]);
      const updated = [...items, ...newItems];
      prevItemsRef.current = updated;
      onChange(updated);
    }
  };

  return (
    <>
      {items.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={renderIds} strategy={verticalListSortingStrategy}>
            <ul className={styles.checklistEdit}>
              {items.map((item, idx) => {
                const checked = item.startsWith('-[x]');
                const text = item.replace(/^-\[x?\]\s*/, '');
                const id = renderIds[idx];
                return (
                  <SortableChecklistItem key={id} id={id} disabled={disabled}>
                    {showCheckboxes ? (
                      <label className={styles.checklistCheckLabel}>
                        <input type="checkbox" checked={checked} disabled={disabled}
                          className={styles.checkbox}
                          onChange={() => handleToggle(idx)} />
                        <span className={checked ? styles.checklistCheckedText : undefined}>{text}</span>
                      </label>
                    ) : (
                      <span className={styles.checklistItemText}>{text}</span>
                    )}
                    {showRemoveButton && (
                      <button type="button" className={styles.checklistRemove}
                        disabled={disabled}
                        onClick={() => handleRemove(idx)}>
                        ✕
                      </button>
                    )}
                  </SortableChecklistItem>
                );
              })}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {showAddInput && (
        <>
          {bulkAddMode ? (
            <div className={styles.checklistBulkAdd}>
              <textarea
                value={bulkAddText}
                onChange={(e) => setBulkAddText(e.target.value)}
                placeholder="Enter one item per line..."
                aria-label="Bulk add checklist items"
                className={styles.textarea}
                disabled={disabled}
                rows={4}
              />
              <div className={styles.checklistBulkActions}>
                <button type="button" className={`${styles.button} ${styles.buttonPrimary} ${styles.checklistAddBtn}`}
                  disabled={disabled || !bulkAddText.trim()}
                  onClick={() => {
                    handleAddBulk(bulkAddText);
                    setBulkAddText('');
                  }}>
                  Add All
                </button>
                <button type="button" className={`${styles.button} ${styles.buttonSecondary} ${styles.checklistAddBtn}`}
                  disabled={disabled}
                  onClick={() => { setBulkAddMode(false); setBulkAddText(''); }}>
                  Single Mode
                </button>
              </div>
            </div>
          ) : (
            <div className={styles.checklistAdd}>
              <input type="text" value={newChecklistItem}
                onChange={(e) => setNewChecklistItem(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newChecklistItem.trim()) {
                    e.preventDefault();
                    handleAddSingle(newChecklistItem.trim());
                    setNewChecklistItem('');
                  }
                }}
                placeholder="Add checklist item..."
                aria-label="Add checklist item"
                className={styles.input} disabled={disabled} />
              <button type="button" className={`${styles.button} ${styles.buttonSecondary} ${styles.checklistAddBtn}`}
                disabled={disabled || !newChecklistItem.trim()}
                onClick={() => {
                  if (newChecklistItem.trim()) {
                    handleAddSingle(newChecklistItem.trim());
                    setNewChecklistItem('');
                  }
                }}>
                Add
              </button>
              <button type="button" className={`${styles.button} ${styles.buttonSecondary} ${styles.checklistAddBtn}`}
                disabled={disabled}
                onClick={() => setBulkAddMode(true)}
                title="Add multiple items at once">
                Bulk
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
