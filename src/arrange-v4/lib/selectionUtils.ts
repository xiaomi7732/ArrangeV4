export function retainExistingIds(
  selectedIds: ReadonlySet<string>,
  existingIds: Iterable<string>,
): Set<string> {
  const existing = new Set(existingIds);
  return new Set(Array.from(selectedIds).filter(id => existing.has(id)));
}
