'use client';

import { useState } from 'react';
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

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex((_, i) => `checklist-${i}` === active.id);
      const newIndex = items.findIndex((_, i) => `checklist-${i}` === over.id);
      onChange(arrayMove(items, oldIndex, newIndex));
    }
  };

  const handleToggle = (idx: number) => {
    const item = items[idx];
    const checked = item.startsWith('-[x]');
    const text = item.replace(/^-\[x?\]\s*/, '');
    const updated = [...items];
    updated[idx] = checked ? '-[] ' + text : '-[x] ' + text;
    onChange(updated);
  };

  const handleRemove = (idx: number) => {
    onChange(items.filter((_, i) => i !== idx));
  };

  const handleAddSingle = (text: string) => {
    onChange([...items, '-[] ' + text]);
  };

  const handleAddBulk = (text: string) => {
    const newItems = text.split('\n').map(l => l.trim()).filter(Boolean).map(l => '-[] ' + l);
    if (newItems.length > 0) {
      onChange([...items, ...newItems]);
    }
  };

  return (
    <>
      {items.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items.map((_, i) => `checklist-${i}`)} strategy={verticalListSortingStrategy}>
            <ul className={styles.checklistEdit}>
              {items.map((item, idx) => {
                const checked = item.startsWith('-[x]');
                const text = item.replace(/^-\[x?\]\s*/, '');
                return (
                  <SortableChecklistItem key={`checklist-${idx}`} id={`checklist-${idx}`} disabled={disabled}>
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
