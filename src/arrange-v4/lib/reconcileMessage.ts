/**
 * Message shown when a refresh that was reconciling a failed write also fails.
 *
 * A write that rejects may still have partly succeeded, so the rolled-back view
 * is only a guess until a refresh confirms it. When that refresh fails too, the
 * user has to be told, or an unverified board looks authoritative.
 */
export function composeReconcileFailure(
  previous: string | null,
  message: string,
  subject: string,
): string {
  if (!previous) return message;
  const suffix = `The ${subject} could not be refreshed either: ${message}`;
  // Repeated failures must not stack: the same sentence is no more informative
  // the third time, and an unbounded string would grow the banner off-screen.
  if (previous.includes(suffix)) return previous;
  if (previous === message) return suffix;
  return `${previous} ${suffix}`;
}
