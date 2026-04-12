# Bug Notes

Lessons learned from bugs encountered during development — documented here so we don't repeat them.

## HamburgerMenu: hardcoded `/matrix` assumptions

**When:** Adding the Cancelled Tasks nav entry (Issue #14)

**Root cause:** `HamburgerMenu.tsx` had two places that assumed `/matrix` was the only `matchPrefix` nav item:

1. **`isActive()`** — used `pathname.startsWith('/matrix')` for *all* `matchPrefix` items, so every prefix-matched page highlighted whenever `/matrix` was active (and vice versa).
2. **`useEffect` building nav hrefs** — replaced the href of *all* `matchPrefix` items with `` `/matrix?bookId=...` `` instead of preserving each item's own route prefix.

**Symptoms:**
- Duplicate React key warning in the console (`Encountered two children with the same key`).
- Both Matrix and Cancelled Tasks highlighted at the same time in the sidebar.

**Fix:** Use each item's own `href` as the base:
```tsx
// isActive — derive base path from the item, not a constant
const basePath = item.href.split('?')[0];
return pathname.startsWith(basePath);

// href builder — use item.href, not '/matrix'
{ ...item, href: `${item.href}?bookId=${encodeURIComponent(savedBookId)}` }
```

**Takeaway:** When adding a new nav item with `matchPrefix: true`, check every code path in `HamburgerMenu.tsx` that branches on `matchPrefix` — none should reference a specific route string.
