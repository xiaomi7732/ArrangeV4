'use client';

import { useState } from 'react';
import { TodoItem } from '@/lib/todoDataService';
import styles from './ManageTags.module.css';

interface ManageTagsProps {
  tags: string[];
  todoItems: (TodoItem & { id?: string })[];
  onRenameTag: (oldTag: string, newTag: string) => Promise<void>;
  onDeleteTag: (tag: string) => Promise<void>;
  onMergeTag: (sourceTag: string, targetTag: string) => Promise<void>;
  onClose: () => void;
}

export default function ManageTags({ tags, todoItems, onRenameTag, onDeleteTag, onMergeTag, onClose }: ManageTagsProps) {
  const [renamingTag, setRenamingTag] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deletingTag, setDeletingTag] = useState<string | null>(null);
  const [mergingTag, setMergingTag] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getItemCount = (tag: string) =>
    todoItems.filter(item => item.categories?.includes(tag)).length;

  const clearActions = () => {
    setRenamingTag(null);
    setDeletingTag(null);
    setMergingTag(null);
    setError(null);
  };

  const startRename = (tag: string) => {
    clearActions();
    setRenamingTag(tag);
    setRenameValue(tag);
  };

  const handleRename = async () => {
    if (!renamingTag || !renameValue.trim()) return;
    const newTag = renameValue.trim();
    if (newTag === renamingTag) { setRenamingTag(null); return; }
    if (tags.includes(newTag)) {
      setError(`Tag "${newTag}" already exists`);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onRenameTag(renamingTag, newTag);
      setRenamingTag(null);
    } catch (err: any) {
      setError(err.message || 'Failed to rename tag');
    } finally {
      setBusy(false);
    }
  };

  const startDelete = (tag: string) => {
    clearActions();
    setDeletingTag(tag);
  };

  const handleDelete = async () => {
    if (!deletingTag) return;

    setBusy(true);
    setError(null);
    try {
      await onDeleteTag(deletingTag);
      setDeletingTag(null);
    } catch (err: any) {
      setError(err.message || 'Failed to delete tag');
    } finally {
      setBusy(false);
    }
  };

  const startMerge = (tag: string) => {
    clearActions();
    setMergingTag(tag);
    const otherTags = tags.filter(t => t !== tag);
    setMergeTarget(otherTags[0] || '');
  };

  const handleMerge = async () => {
    if (!mergingTag || !mergeTarget) return;

    setBusy(true);
    setError(null);
    try {
      await onMergeTag(mergingTag, mergeTarget);
      setMergingTag(null);
    } catch (err: any) {
      setError(err.message || 'Failed to merge tags');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>Manage Tags</h2>

        {error && (
          <div className={styles.error} role="alert">{error}</div>
        )}

        <div className={styles.tagList}>
          {tags.length === 0 && (
            <p className={styles.empty}>No tags yet</p>
          )}
          {tags.map(tag => {
            const count = getItemCount(tag);

            if (renamingTag === tag) {
              return (
                <div key={tag} className={styles.renameRow}>
                  <input
                    className={styles.renameInput}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRename();
                      if (e.key === 'Escape') setRenamingTag(null);
                    }}
                    disabled={busy}
                    autoFocus
                  />
                  <div className={styles.renameActions}>
                    <button
                      className={`${styles.renameBtn} ${styles.renameSave}`}
                      onClick={handleRename}
                      disabled={busy || !renameValue.trim() || renameValue.trim() === tag}
                    >
                      {busy ? '...' : 'Save'}
                    </button>
                    <button
                      className={`${styles.renameBtn} ${styles.renameCancel}`}
                      onClick={() => setRenamingTag(null)}
                      disabled={busy}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              );
            }

            if (deletingTag === tag) {
              return (
                <div key={tag} className={styles.confirmRow}>
                  <span className={styles.confirmText}>
                    Remove &ldquo;{tag}&rdquo; from {count} item{count !== 1 ? 's' : ''}?
                  </span>
                  <div className={styles.confirmActions}>
                    <button
                      className={styles.confirmDelete}
                      onClick={handleDelete}
                      disabled={busy}
                    >
                      {busy ? '...' : 'Delete'}
                    </button>
                    <button
                      className={styles.confirmCancel}
                      onClick={() => setDeletingTag(null)}
                      disabled={busy}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              );
            }

            if (mergingTag === tag) {
              const otherTags = tags.filter(t => t !== tag);
              return (
                <div key={tag} className={styles.mergeRow}>
                  <span className={styles.mergeText}>
                    Merge &ldquo;{tag}&rdquo; into
                  </span>
                  <select
                    className={styles.mergeSelect}
                    value={mergeTarget}
                    onChange={(e) => setMergeTarget(e.target.value)}
                    disabled={busy}
                  >
                    {otherTags.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <div className={styles.confirmActions}>
                    <button
                      className={`${styles.renameBtn} ${styles.renameSave}`}
                      onClick={handleMerge}
                      disabled={busy || !mergeTarget}
                    >
                      {busy ? '...' : 'Merge'}
                    </button>
                    <button
                      className={`${styles.renameBtn} ${styles.renameCancel}`}
                      onClick={() => setMergingTag(null)}
                      disabled={busy}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div key={tag} className={styles.tagRow}>
                <span className={styles.tagName}>{tag}</span>
                <span className={styles.tagCount}>{count} item{count !== 1 ? 's' : ''}</span>
                <div className={styles.tagActions}>
                  <button
                    className={styles.iconButton}
                    onClick={() => startRename(tag)}
                    disabled={busy}
                    title="Rename tag"
                  >
                    ✏️
                  </button>
                  {tags.length > 1 && (
                    <button
                      className={styles.iconButton}
                      onClick={() => startMerge(tag)}
                      disabled={busy}
                      title="Merge into another tag"
                    >
                      🔀
                    </button>
                  )}
                  <button
                    className={`${styles.iconButton} ${styles.iconButtonDanger}`}
                    onClick={() => startDelete(tag)}
                    disabled={busy}
                    title="Delete tag"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className={styles.footer}>
          <button className={styles.closeButton} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
