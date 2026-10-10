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
  /** Explains a gap between result and total caused by the status filters. */
  hiddenSummary?: string | null;
  /**
   * How far the loaded data reaches, e.g. the board's date window. Shown with
   * the count and announced with it, so neither the total nor "Show hidden"
   * implies the view can reach work it never loaded.
   */
  scopeNote?: string | null;
  /** Switches the status filters that are hiding items back to "All". */
  onRevealHidden?: () => void;
  onTextChange: (text: string) => void;
  onClearAll: () => void;
  presets: FilterPreset[];
  activePresetId: string | null;
  /** Preset the user last applied or saved; kept even after editing its filters. */
  selectedPresetId: string | null;
  presetError: string | null;
  onApplyPreset: (presetId: string) => void;
  onSavePreset: (name: string) => boolean;
  onRenamePreset: (presetId: string, name: string) => boolean;
  onDeletePreset: (presetId: string) => void;
  onDismissPresetError: () => void;
  /**
   * Whether this view can express urgency/importance filters. Pass the value
   * from `useTaskQuery`, which derives it from the view's preset scope, so the
   * controls and the saved presets always agree.
   */
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
  hiddenSummary = null,
  scopeNote = null,
  onRevealHidden,
  onTextChange,
  onClearAll,
  presets,
  activePresetId,
  selectedPresetId,
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
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const presetSelectRef = useRef<HTMLSelectElement>(null);
  // Set by handlers that unmount the element holding focus, so the next render
  // can hand focus to the control that replaces it instead of dropping it to
  // <body> and restarting tab order from the top of the page.
  const pendingFocusRef = useRef<'save' | 'presets' | null>(null);
  const presetSelectId = useId();
  const [announcedCount, setAnnouncedCount] = useState('');

  const activePreset = presets.find(preset => preset.id === activePresetId) ?? null;

  // A pending rename or delete belongs to one specific preset. When that preset
  // stops being the active one — the user edited the filters, picked another
  // preset, or deleted it — the pending action is abandoned. Clearing the state
  // here (rather than merely hiding the form) stops an abandoned rename from
  // reappearing, and stealing focus, if the query later matches that preset again.
  if (formMode === 'rename' && formTargetId !== activePresetId) {
    setFormMode(null);
    setFormTargetId(null);
    setPresetName('');
  }
  // Likewise, an open save form is meaningless once there is nothing to save.
  if (formMode === 'save' && !queryActive) {
    setFormMode(null);
    setPresetName('');
  }
  if (confirmingDeleteId !== null && confirmingDeleteId !== activePresetId) {
    setConfirmingDeleteId(null);
  }

  const confirmingDelete = !!activePreset && confirmingDeleteId === activePreset.id;

  useEffect(() => {
    if (formMode) presetNameRef.current?.focus();
  }, [formMode]);

  useEffect(() => {
    const target = pendingFocusRef.current;
    if (!target) return;
    pendingFocusRef.current = null;
    const candidates = target === 'presets'
      ? [presetSelectRef.current, saveButtonRef.current, searchInputRef.current]
      : [saveButtonRef.current, searchInputRef.current];
    // A disabled control cannot take focus — deleting the last preset disables
    // the select, and an inactive query disables Save — so skip to the next one.
    candidates.find(node => node && !node.disabled)?.focus();
  });

  // Let the result count settle before announcing it, so a screen reader reads
  // one outcome per search rather than one per keystroke.
  useEffect(() => {
    const parts = [`Showing ${resultCount} of ${totalCount} items`];
    if (hiddenSummary) parts.push(hiddenSummary);
    if (scopeNote) parts.push(scopeNote);
    const timer = setTimeout(() => setAnnouncedCount(parts.join(', ')), 500);
    return () => clearTimeout(timer);
  }, [resultCount, totalCount, hiddenSummary, scopeNote]);

  const openSaveForm = () => {
    // Prefill from the preset being edited so saving updates it in place rather
    // than making the user retype its name. After a filter edit the preset is no
    // longer "active" by value, but it is still the one being worked on.
    const editing = presets.find(preset => preset.id === selectedPresetId) ?? null;
    setPresetName((activePreset ?? editing)?.name ?? '');
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
    pendingFocusRef.current = 'save';
  };

  const submitForm = (event: React.FormEvent) => {
    event.preventDefault();
    if (!formMode) return;

    const succeeded = formMode === 'rename' && activePreset
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
    pendingFocusRef.current = 'presets';
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

        {/*
          Hidden from assistive technology: the same sentence is announced by
          the live region below, and exposing both reads it twice.
        */}
        <span
          className={styles.resultCount}
          aria-hidden="true"
        >
          Showing {resultCount} of {totalCount} items
          {hiddenSummary ? ` — ${hiddenSummary}` : ''}
          {scopeNote ? ` (${scopeNote})` : ''}
        </span>
        {hiddenSummary && onRevealHidden && (
          <button
            type="button"
            className={`${styles.chip} ${styles.revealHidden}`}
            onClick={onRevealHidden}
            disabled={disabled}
            aria-label={`Show hidden items: ${hiddenSummary}`}
          >
            Show hidden
          </button>
        )}
        {/*
          Announced separately and on a delay: the visible count changes on every
          keystroke, and a live region tied to it would queue one announcement per
          character and lag behind the typing.
        */}
        <span className={styles.srOnly} role="status">{announcedCount}</span>

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
            ref={presetSelectRef}
            className={styles.presetSelect}
            value={activePresetId ?? ''}
            onChange={event => {
              closeForm();
              // The select itself keeps focus here; only an unmounting control
              // needs focus handed on.
              pendingFocusRef.current = null;
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

          {formMode === null && (
            <>
              <button
                type="button"
                ref={saveButtonRef}
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

          {formMode !== null && (
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
                aria-label={formMode === 'rename' ? 'New filter name' : 'Name for this filter'}
                maxLength={MAX_PRESET_NAME_LENGTH}
              />
              <button type="submit" className={`${styles.chip} ${styles.chipPrimary}`}>
                {formMode === 'rename' ? 'Rename' : 'Save'}
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
