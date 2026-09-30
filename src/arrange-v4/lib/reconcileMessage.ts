/**
 * Message shown when a refresh that was reconciling a failed write also fails.
 *
 * A write that rejects may still have partly succeeded, so the rolled-back view
 * is only a guess until a refresh confirms it. When that refresh fails too, the
 * user has to be told, or an unverified board looks authoritative.
 *
 * Callers pass the failure of the *write*, never the banner they are showing:
 * recomposing from the same fixed text means a run of failed refreshes replaces
 * its sentence instead of stacking one per attempt.
 */
export function composeReconcileFailure(
  writeFailure: string | null,
  message: string,
  subject: string,
): string {
  if (!writeFailure) return message;
  const suffix = `The ${subject} could not be refreshed either: ${message}`;
  if (writeFailure === message) return suffix;
  return `${writeFailure} ${suffix}`;
}
