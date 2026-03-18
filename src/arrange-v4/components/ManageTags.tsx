'use client';

import { useState } from 'react';
import { TodoItem } from '@/lib/todoDataService';
import styles from './ManageTags.module.css';

interface ManageTagsProps {
  tags: string[];
  todoItems: (TodoItem & { id?: string })[];
  onRenameTag: (oldTag: string, newTag: string) => Promise<void>;
  onDeleteTag: (tag: string) => Promise<void>;
  onClose: () => void;
}

export default function ManageTags({ tags, todoItems, onRenameTag, onDeleteTag, onClose }: ManageTagsProps) {
  const [renamingTag, setRenamingTag] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deletingTag, setDeletingTag] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getItemCount = (tag: string) =>
    todoItems.filter(item => item.categories?.includes(tag)).length;

  const startRename = (tag: string) => {
    setRenamingTag(tag);
    setRenameValue(tag);
    setDeletingTag(null);
    setError(null);
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
    setDeletingTag(tag);
    setRenamingTag(null);
    setError(null);
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
