'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import {
  closestCenter,
  pointerWithin,
  useDroppable,
  type CollisionDetection,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { createClickSuppressor, type ClickSuppressor } from '@/lib/dragClick';
import styles from './SortableTodo.module.css';

interface SortableTodoProps {
  id: string;
  containerId: string;
  disabled?: boolean;
  children: ReactNode;
}

function GripIcon() {
  return (
    <svg className={styles.gripIcon} viewBox="0 0 12 30" aria-hidden="true">
      {[3, 9].flatMap(x =>
        [3, 9, 15, 21, 27].map(y => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.5" />),
      )}
    </svg>
  );
}

export function SortableTodo({ id, containerId, disabled = false, children }: SortableTodoProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    data: { containerId },
    disabled,
  });

  // The whole card is the drag surface, so the click that ends a drag has to be
  // swallowed or dropping a card would also open it.
  const suppressor = useRef<ClickSuppressor>(createClickSuppressor());

  useEffect(() => {
    if (isDragging) suppressor.current.noteDragging();
  }, [isDragging]);

  const handleClickCapture = (event: React.MouseEvent) => {
    if (!suppressor.current.shouldSuppressClick()) return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div
      ref={setNodeRef}
      className={styles.wrapper}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.35 : 1,
      }}
      // Dragging from anywhere on the card, not just the grip. The sensors are
      // configured with a distance (mouse) and delay (touch) threshold, so a
      // plain click on the card or on a button inside it still works; the grip
      // stays as the visual hint and the keyboard-reachable activator.
      onPointerDownCapture={() => suppressor.current?.notePointerDown()}
      onClickCapture={handleClickCapture}
      {...listeners}
    >
      <div className={styles.content}>{children}</div>
      <button
        ref={setActivatorNodeRef}
        type="button"
        className={styles.dragHandle}
        aria-label="Drag to reorder"
        {...attributes}
      >
        <GripIcon />
      </button>
    </div>
  );
}

export function SortableTodoOverlay({ children }: { children: ReactNode }) {
  return (
    <div className={styles.wrapper}>
      <div className={styles.content}>{children}</div>
      <div className={styles.dragHandle} aria-hidden="true">
        <GripIcon />
      </div>
    </div>
  );
}

export const sortableTodoKeyboardCoordinates: KeyboardCoordinateGetter = (
    event,
    { context, currentCoordinates },
  ) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.code)) return;
    event.preventDefault();
    const collisionRect = context.collisionRect;
    if (!collisionRect) return;

    const currentId = context.over?.id ?? context.active?.id;
    const current = currentId == null ? null : context.droppableContainers.get(currentId);
    const currentContainerId = current?.data.current?.containerId;
    if (!current || !currentContainerId) return;

    const candidates = context.droppableContainers.getEnabled()
      .filter(container =>
        (container.id !== context.active?.id || currentId !== context.active?.id) &&
        (container.data.current?.sortable != null || container.data.current?.isEnd === true)
      )
      .map(container => ({ container, rect: context.droppableRects.get(container.id) }))
      .filter((candidate): candidate is typeof candidate & { rect: NonNullable<typeof candidate.rect> } =>
        candidate.rect != null
      );

    const currentRect = context.droppableRects.get(current.id) ?? collisionRect;
    const currentCenter = {
      x: currentRect.left + currentRect.width / 2,
      y: currentRect.top + currentRect.height / 2,
    };

    let eligible = candidates
      .map(candidate => ({
        ...candidate,
        center: {
          x: candidate.rect.left + candidate.rect.width / 2,
          y: candidate.rect.top + candidate.rect.height / 2,
        },
      }))
      .filter(candidate => {
        if (event.code === 'ArrowDown') return candidate.center.y > currentCenter.y + 1;
        if (event.code === 'ArrowUp') return candidate.center.y < currentCenter.y - 1;
        if (event.code === 'ArrowRight') return candidate.center.x > currentCenter.x + 1;
        return candidate.center.x < currentCenter.x - 1;
      });

  if (event.code === 'ArrowDown' || event.code === 'ArrowUp') {
      const sameContainer = eligible.filter(
        candidate => candidate.container.data.current?.containerId === currentContainerId,
      );
      if (sameContainer.length > 0) eligible = sameContainer;
  }

  eligible.sort((a, b) => {
        const aPrimary = event.code === 'ArrowDown' || event.code === 'ArrowUp'
          ? Math.abs(a.center.y - currentCenter.y)
          : Math.abs(a.center.x - currentCenter.x);
        const bPrimary = event.code === 'ArrowDown' || event.code === 'ArrowUp'
          ? Math.abs(b.center.y - currentCenter.y)
          : Math.abs(b.center.x - currentCenter.x);
        const aCross = event.code === 'ArrowDown' || event.code === 'ArrowUp'
          ? Math.abs(a.center.x - currentCenter.x)
          : Math.abs(a.center.y - currentCenter.y);
        const bCross = event.code === 'ArrowDown' || event.code === 'ArrowUp'
          ? Math.abs(b.center.x - currentCenter.x)
          : Math.abs(b.center.y - currentCenter.y);
      return aPrimary - bPrimary || aCross - bCross;
  });

    const targetRect = eligible[0]?.rect;
    if (!targetRect) return;
    const targetCenter = eligible[0].center;
    const collisionCenter = {
      x: collisionRect.left + collisionRect.width / 2,
      y: collisionRect.top + collisionRect.height / 2,
    };
    return {
      x: currentCoordinates.x + targetCenter.x - collisionCenter.x,
      y: currentCoordinates.y + targetCenter.y - collisionCenter.y,
    };
  };

export const sortableTodoCollisionDetection: CollisionDetection = (args) => {
  const containers = args.droppableContainers.filter(
    container => container.data.current?.isContainer === true,
  );
  const pointerContainer = pointerWithin({
    ...args,
    droppableContainers: containers,
  })[0];
  const collisionCenter = {
    x: args.collisionRect.left + args.collisionRect.width / 2,
    y: args.collisionRect.top + args.collisionRect.height / 2,
  };
  const keyboardContainer = containers.find(container => {
    const rect = args.droppableRects.get(container.id);
    return rect &&
      collisionCenter.x >= rect.left &&
      collisionCenter.x <= rect.right &&
      collisionCenter.y >= rect.top &&
      collisionCenter.y <= rect.bottom;
  });
  const targetContainer = pointerContainer ?? (keyboardContainer
    ? { id: keyboardContainer.id, data: { droppableContainer: keyboardContainer, value: 0 } }
    : undefined);

  if (targetContainer) {
    const activeContainerId = args.active.data.current?.containerId;
    const itemsInContainer = args.droppableContainers.filter(
      container =>
        (container.data.current?.sortable != null || container.data.current?.isEnd === true) &&
        (container.id !== args.active.id || activeContainerId === String(targetContainer.id)) &&
        container.data.current?.containerId === String(targetContainer.id),
    );
    const itemCollisions = closestCenter({
      ...args,
      droppableContainers: itemsInContainer,
    });
    return itemCollisions.length > 0 ? itemCollisions : [targetContainer];
  }

  const itemCollisions = closestCenter({
    ...args,
    droppableContainers: args.droppableContainers.filter(
      container =>
        (container.data.current?.sortable != null || container.data.current?.isEnd === true) &&
        container.id !== args.active.id,
    ),
  });
  if (itemCollisions.length > 0) return itemCollisions;

  return closestCenter({
    ...args,
    droppableContainers: containers,
  });
};

interface SortableTodoListProps {
  id: string;
  itemIds: string[];
  className?: string;
  children: ReactNode;
}

export function SortableTodoList({ id, itemIds, className, children }: SortableTodoListProps) {
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { containerId: id, isContainer: true },
  });
  const { setNodeRef: setEndNodeRef, isOver: isEndOver } = useDroppable({
    id: `${id}:end`,
    data: { containerId: id, isEnd: true },
  });

  return (
    <div ref={setNodeRef} className={className} data-drag-over={isOver || undefined}>
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
      <div
        ref={setEndNodeRef}
        className={styles.endTarget}
        data-drag-over={isEndOver || undefined}
        aria-hidden="true"
      />
    </div>
  );
}
