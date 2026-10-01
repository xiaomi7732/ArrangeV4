'use client';

import styles from './EmptyListMessage.module.css';

interface EmptyListMessageProps {
  /** True when a search or filter is active, i.e. the emptiness may be self-inflicted. */
  filtered: boolean;
  onClearFilters: () => void;
  /** The owning view's empty-paragraph class, so spacing stays view-specific. */
  className?: string;
}

/**
 * The empty state for a quadrant or lane.
 *
 * A genuinely empty container and one emptied by a filter look identical
 * otherwise, which reads as lost data. When a filter is active we say so and
 * offer recovery in place.
 */
export default function EmptyListMessage({
  filtered,
  onClearFilters,
  className,
}: EmptyListMessageProps) {
  if (!filtered) {
    return <p className={className}>No items</p>;
  }

  return (
    <p className={className}>
      No items match your filters.{' '}
      <button type="button" className={styles.clearButton} onClick={onClearFilters}>
        Clear filters
      </button>
    </p>
  );
}
