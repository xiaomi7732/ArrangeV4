/**
 * A failure message that says which action failed before why it failed.
 *
 * Store errors are written for developers: "Failed to fetch" on its own tells
 * a user nothing about whether their edit, their reorder or the refresh is the
 * thing that did not happen. The action is ours and always present; the detail
 * is the backend's and may be missing or redundant.
 */
export function describeFailure(action: string, err: unknown): string {
  const detail = err instanceof Error ? err.message.trim() : '';
  if (!detail || action.includes(detail)) return action;
  return `${action} ${detail}`;
}
