import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { nextTabIndex, tabElementId, tabPanelElementId } from './dialogTabs';

describe('nextTabIndex', () => {
  it('moves right and wraps past the last tab', () => {
    assert.equal(nextTabIndex(0, 'ArrowRight', 4), 1);
    assert.equal(nextTabIndex(3, 'ArrowRight', 4), 0);
  });

  it('moves left and wraps past the first tab', () => {
    assert.equal(nextTabIndex(2, 'ArrowLeft', 4), 1);
    assert.equal(nextTabIndex(0, 'ArrowLeft', 4), 3);
  });

  it('jumps to the ends with Home and End', () => {
    assert.equal(nextTabIndex(2, 'Home', 4), 0);
    assert.equal(nextTabIndex(1, 'End', 4), 3);
  });

  it('leaves unrelated keys to the browser', () => {
    for (const key of ['ArrowUp', 'ArrowDown', 'Tab', 'Enter', ' ', 'Escape']) {
      assert.equal(nextTabIndex(1, key, 4), null, key);
    }
  });

  it('does nothing for an empty tablist', () => {
    assert.equal(nextTabIndex(0, 'ArrowRight', 0), null);
  });
});

describe('tab element ids', () => {
  it('derives distinct, stable ids for the tab and its panel', () => {
    assert.equal(tabElementId('dlg', 'remarks'), 'dlg-tab-remarks');
    assert.equal(tabPanelElementId('dlg', 'remarks'), 'dlg-panel-remarks');
    assert.notEqual(tabElementId('dlg', 'remarks'), tabPanelElementId('dlg', 'remarks'));
  });
});
