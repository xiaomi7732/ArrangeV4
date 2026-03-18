'use client';

import { useState } from 'react';
import styles from './AddTodoItem.module.css';

interface TagPickerProps {
  availableCategories: string[];
  categories: string[];
  onChange: (categories: string[]) => void;
  disabled?: boolean;
}

export default function TagPicker({ availableCategories, categories, onChange, disabled = false }: TagPickerProps) {
  const [newCategory, setNewCategory] = useState('');

  const addCategory = (cat: string) => {
    if (!categories.includes(cat)) {
      onChange([...categories, cat]);
    }
  };

  const removeCategory = (cat: string) => {
    onChange(categories.filter(c => c !== cat));
  };

  const handleAddNew = () => {
    const cat = newCategory.trim();
    if (cat) {
      addCategory(cat);
      setNewCategory('');
    }
  };

  return (
    <div className={styles.categorySection}>
      <label className={styles.label}>Tags</label>
      {(availableCategories.length > 0 || categories.length > 0) && (
        <div className={styles.categoryChips}>
          {availableCategories.filter(c => !categories.includes(c)).map(cat => (
            <button
              key={cat}
              type="button"
              className={styles.categoryChip}
              disabled={disabled}
              onClick={() => addCategory(cat)}
            >
              {cat}
            </button>
          ))}
          {categories.map(cat => (
            <button
              key={cat}
              type="button"
              className={`${styles.categoryChip} ${styles.categoryChipSelected}`}
              disabled={disabled}
              onClick={() => removeCategory(cat)}
            >
              {cat}
              <span className={styles.categoryChipRemove}>✕</span>
            </button>
          ))}
        </div>
      )}
      <div className={styles.categoryAdd}>
        <input
          type="text"
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newCategory.trim()) {
              e.preventDefault();
              handleAddNew();
            }
          }}
          placeholder="Add new tag..."
          className={styles.input}
          disabled={disabled}
        />
        <button
          type="button"
          className={`${styles.button} ${styles.buttonSecondary} ${styles.categoryAddBtn}`}
          disabled={disabled || !newCategory.trim()}
          onClick={handleAddNew}
        >
          Add
        </button>
      </div>
    </div>
  );
}
