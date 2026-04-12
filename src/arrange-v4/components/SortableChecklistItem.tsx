'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import styles from './AddTodoItem.module.css';

interface SortableChecklistItemProps {
  id: string;
  children: React.ReactNode;
  disabled?: boolean;
}

export default function SortableChecklistItem({ id, children, disabled }: SortableChecklistItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li ref={setNodeRef} style={style} className={styles.checklistEditItem}>
      <button
        type="button"
        className={styles.checklistDragHandle}
        {...attributes}
        {...listeners}
        disabled={disabled}
        aria-disabled={disabled}
        aria-label="Drag to reorder"
      >
        ⠿
      </button>
      {children}
    </li>
  );
}
