'use client';

import { useState, useRef, useCallback } from 'react';
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

  // Stable IDs for sortable items — tracked via ref so they persist across renders
  const nextIdCounter = useRef(items.length);
  const stableIds = useRef<string[]>(generateIds(items.length, 0));

  // Sync stable IDs when items length changes from external updates
  if (stableIds.current.length !== items.length) {
    if (items.length > stableIds.current.length) {
      const newIds = generateIds(items.length - stableIds.current.length, nextIdCounter.current);
      nextIdCounter.current += newIds.length;
      stableIds.current = [...stableIds.current, ...newIds];
    } else {
      stableIds.current = stableIds.current.slice(0, items.length);
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const ids = stableIds.current;
      const oldIndex = ids.indexOf(String(active.id));
      const newIndex = ids.indexOf(String(over.id));
      if (oldIndex >= 0 && newIndex >= 0) {
        stableIds.current = arrayMove(ids, oldIndex, newIndex);
        onChange(arrayMove(items, oldIndex, newIndex));
      }
    }
  }, [items, onChange]);

  const handleToggle = (idx: number) => {
    const item = items[idx];
    const checked = item.startsWith('-[x]');
    const text = item.replace(/^-\[x?\]\s*/, '');
    const updated = [...items];
    updated[idx] = checked ? '-[] ' + text : '-[x] ' + text;
    onChange(updated);
  };

  const handleRemove = (idx: number) => {
    stableIds.current = stableIds.current.filter((_, i) => i !== idx);
    onChange(items.filter((_, i) => i !== idx));
  };

  const handleAddSingle = (text: string) => {
    stableIds.current = [...stableIds.current, `cl-${nextIdCounter.current++}`];
    onChange([...items, '-[] ' + text]);
  };

  const handleAddBulk = (text: string) => {
    const newItems = text.split('\n').map(l => l.trim()).filter(Boolean).map(l => '-[] ' + l);
    if (newItems.length > 0) {
      const newIds = generateIds(newItems.length, nextIdCounter.current);
      nextIdCounter.current += newIds.length;
      stableIds.current = [...stableIds.current, ...newIds];
      onChange([...items, ...newItems]);
    }
  };

  return (
    <>
      {items.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={stableIds.current} strategy={verticalListSortingStrategy}>
            <ul className={styles.checklistEdit}>
              {items.map((item, idx) => {
                const checked = item.startsWith('-[x]');
                const text = item.replace(/^-\[x?\]\s*/, '');
                const itemId = stableIds.current[idx];
                return (
                  <SortableChecklistItem key={itemId} id={itemId} disabled={disabled}>
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
