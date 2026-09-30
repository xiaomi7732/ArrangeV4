'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { MAX_PRESET_NAME_LENGTH, type FilterPreset } from '@/lib/search/filterPresets';
import type { TaskQuery } from '@/lib/search/taskQuery';
import styles from './TaskSearchBar.module.css';

type PresetFormMode = 'save' | 'rename';

export interface TaskSearchBarProps {
  query: TaskQuery;
  queryActive: boolean;
  resultCount: number;
  totalCount: number;
  onTextChange: (text: string) => void;
  onClearAll: () => void;
  presets: FilterPreset[];
  activePresetId: string | null;
  presetError: string | null;
  onApplyPreset: (presetId: string) => void;
  onSavePreset: (name: string) => boolean;
  onRenamePreset: (presetId: string, name: string) => boolean;
  onDeletePreset: (presetId: string) => void;
  onDismissPresetError: () => void;
  /** Matrix/Scrum expose urgency and importance; Cancelled does not. */
  showPriorityFilters?: boolean;
  onToggleUrgentOnly?: () => void;
  onToggleImportantOnly?: () => void;
  disabled?: boolean;
}

export default function TaskSearchBar({
  query,
  queryActive,
  resultCount,
  totalCount,
  onTextChange,
  onClearAll,
  presets,
  activePresetId,
  presetError,
  onApplyPreset,
  onSavePreset,
  onRenamePreset,
  onDeletePreset,
  onDismissPresetError,
  showPriorityFilters = false,
  onToggleUrgentOnly,
  onToggleImportantOnly,
  disabled = false,
}: TaskSearchBarProps) {
  const [formMode, setFormMode] = useState<PresetFormMode | null>(null);
  const [formTargetId, setFormTargetId] = useState<string | null>(null);
  const [presetName, setPresetName] = useState('');
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const presetNameRef = useRef<HTMLInputElement>(null);
  const presetSelectId = useId();

  const activePreset = presets.find(preset => preset.id === activePresetId) ?? null;

  // Pending rename/delete state is derived from the active preset instead of
  // being reset in an effect, so changing the selection (or editing filters,
  // which clears the active preset) implicitly abandons the pending action.
  const visibleFormMode: PresetFormMode | null = formMode === 'rename'
    ? (activePreset && formTargetId === activePreset.id ? 'rename' : null)
    : formMode;
  const confirmingDelete = !!activePreset && confirmingDeleteId === activePreset.id;

  useEffect(() => {
    if (visibleFormMode) presetNameRef.current?.focus();
  }, [visibleFormMode]);

  const openSaveForm = () => {
    setPresetName(activePreset?.name ?? '');
    setConfirmingDeleteId(null);
    setFormTargetId(null);
    setFormMode('save');
  };

  const openRenameForm = () => {
    if (!activePreset) return;
    setPresetName(activePreset.name);
    setConfirmingDeleteId(null);
    setFormTargetId(activePreset.id);
    setFormMode('rename');
  };

  const closeForm = () => {
    setFormMode(null);
    setFormTargetId(null);
    setPresetName('');
    onDismissPresetError();
  };

  const submitForm = (event: React.FormEvent) => {
    event.preventDefault();
    if (!visibleFormMode) return;

    const succeeded = visibleFormMode === 'rename' && activePreset
      ? onRenamePreset(activePreset.id, presetName)
      : onSavePreset(presetName);

    if (succeeded) closeForm();
  };

  const handleDelete = () => {
    if (!activePreset) return;
    if (!confirmingDelete) {
      setConfirmingDeleteId(activePreset.id);
      return;
    }
    onDeletePreset(activePreset.id);
    setConfirmingDeleteId(null);
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && query.text) {
      event.preventDefault();
      onTextChange('');
    }
  };

  return (
    <div className={styles.searchBar}>
      <div className={styles.searchRow}>
        <div className={styles.searchField}>
          <span className={styles.searchIcon} aria-hidden="true">🔍</span>
          <input
            ref={searchInputRef}
            type="search"
            className={styles.searchInput}
            value={query.text}
            onChange={event => onTextChange(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search title, tags, remarks, checklist"
            aria-label="Search tasks"
            disabled={disabled}
          />
          {query.text && (
            <button
              type="button"
              className={styles.searchClear}
              onClick={() => {
                onTextChange('');
                searchInputRef.current?.focus();
              }}
              aria-label="Clear search text"
            >
              ✕
            </button>
          )}
        </div>

        <span className={styles.resultCount} role="status">
          Showing {resultCount} of {totalCount} items
        </span>

        {queryActive && (
          <button
            type="button"
            className={`${styles.chip} ${styles.clearAll}`}
            onClick={onClearAll}
            disabled={disabled}
          >
            ✕ Clear all
          </button>
        )}
      </div>

      <div className={styles.controlRow}>
        {showPriorityFilters && (
          <div className={styles.priorityGroup} role="group" aria-label="Priority filters">
            <button
              type="button"
              className={`${styles.chip} ${query.urgentOnly ? styles.chipActive : ''}`}
              aria-pressed={query.urgentOnly}
              onClick={onToggleUrgentOnly}
              disabled={disabled}
            >
              Urgent
            </button>
            <button
              type="button"
              className={`${styles.chip} ${query.importantOnly ? styles.chipActive : ''}`}
              aria-pressed={query.importantOnly}
              onClick={onToggleImportantOnly}
              disabled={disabled}
            >
              Important
            </button>
          </div>
        )}

        <div className={styles.presetGroup}>
          <label className={styles.presetLabel} htmlFor={presetSelectId}>
            Saved
          </label>
          <select
            id={presetSelectId}
            className={styles.presetSelect}
            value={activePresetId ?? ''}
            onChange={event => {
              closeForm();
              setConfirmingDeleteId(null);
              if (event.target.value) onApplyPreset(event.target.value);
            }}
            disabled={disabled || presets.length === 0}
          >
            <option value="">
              {presets.length === 0 ? 'No saved filters' : 'Custom filter'}
            </option>
            {presets.map(preset => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>

          {visibleFormMode === null && (
            <>
              <button
                type="button"
                className={styles.chip}
                onClick={openSaveForm}
                disabled={disabled || !queryActive}
                title={queryActive
                  ? 'Save the current filters'
                  : 'Adjust search or filters before saving'}
              >
                Save
              </button>
              {activePreset && (
                <>
                  <button
                    type="button"
                    className={styles.chip}
                    onClick={openRenameForm}
                    disabled={disabled}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className={`${styles.chip} ${confirmingDelete ? styles.chipDanger : ''}`}
                    onClick={handleDelete}
                    disabled={disabled}
                  >
                    {confirmingDelete ? 'Confirm delete' : 'Delete'}
                  </button>
                </>
              )}
            </>
          )}

          {visibleFormMode !== null && (
            <form className={styles.presetForm} onSubmit={submitForm}>
              <input
                ref={presetNameRef}
                type="text"
                className={styles.presetInput}
                value={presetName}
                onChange={event => setPresetName(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    closeForm();
                  }
                }}
                placeholder="Filter name"
                aria-label={visibleFormMode === 'rename' ? 'New filter name' : 'Name for this filter'}
                maxLength={MAX_PRESET_NAME_LENGTH}
              />
              <button type="submit" className={`${styles.chip} ${styles.chipPrimary}`}>
                {visibleFormMode === 'rename' ? 'Rename' : 'Save'}
              </button>
              <button type="button" className={styles.chip} onClick={closeForm}>
                Cancel
              </button>
            </form>
          )}
        </div>
      </div>

      {presetError && (
        <p className={styles.presetError} role="alert">{presetError}</p>
      )}
    </div>
  );
}
