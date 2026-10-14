import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowLoadingPlaceholder } from './loadingPlaceholder';

describe('shouldShowLoadingPlaceholder', () => {
  it('shows nothing while there is nothing to load', () => {
    assert.equal(
      shouldShowLoadingPlaceholder({ loading: false, bookId: 'b1', itemsBookId: 'b1' }),
      false,
    );
  });

  it('stands in for a first load, which has nothing to show yet', () => {
    assert.equal(
      shouldShowLoadingPlaceholder({ loading: true, bookId: 'b1', itemsBookId: null }),
      true,
    );
  });

  it('stands in while switching to a book whose items are not in hand', () => {
    assert.equal(
      shouldShowLoadingPlaceholder({ loading: true, bookId: 'b2', itemsBookId: 'b1' }),
      true,
    );
  });

  it('keeps the current book on screen through a background refresh', () => {
    // The whole point: a refresh must not unmount the board, because an open
    // dialog goes down with it and takes the user's draft along.
    assert.equal(
      shouldShowLoadingPlaceholder({ loading: true, bookId: 'b1', itemsBookId: 'b1' }),
      false,
    );
  });

  it('stands in when no book is selected but items are still held', () => {
    assert.equal(
      shouldShowLoadingPlaceholder({ loading: true, bookId: null, itemsBookId: 'b1' }),
      true,
    );
  });
});
