/**
 * Codec for the Arrange payload embedded in an Outlook event body.
 *
 * The payload is JSON fenced between two markers inside a `<pre>` block. The
 * event body is HTML owned by Outlook once written, so neither the framing nor
 * the whitespace can be assumed to survive untouched. Everything here is pure
 * so the round-trip can be tested without a DOM or a network.
 *
 * Relative imports only: this module is compiled by tsconfig.test.json and run
 * directly on Node, which does not resolve the `@/` path alias.
 */

export const ARRANGE_DATA_START_MARKER = '====ArrangeDataStart====';
export const ARRANGE_DATA_END_MARKER = '====ArrangeDataEnd====';

/** Shared prefix of both markers — the only part we need to neutralise. */
const MARKER_PREFIX = '====ArrangeData';

/**
 * `\u0041` is the JSON escape for `A`. Swapping the literal `A` for its escape
 * keeps the parsed string byte-identical while ensuring the serialised text
 * can never contain a sequence that looks like a marker.
 */
const ESCAPED_MARKER_PREFIX = '====\\u0041rrangeData';

export type ArrangePayloadResult<T> =
  | { status: 'ok'; data: T }
  /** No Arrange payload at all — e.g. an event created directly in Outlook. */
  | { status: 'absent' }
  /** Markers present but the payload could not be read. Never treat as empty. */
  | { status: 'corrupt'; reason: string };

/**
 * Characters HTML normalisation adds or rewrites, which a reader must strip
 * before parsing. Escaping them on write means any literal occurrence found on
 * read came from Outlook, never from the user's own content.
 */
const NORMALIZATION_SENSITIVE_REGEX = /[\u00A0\u200B-\u200D\uFEFF]/g;

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Repairs the characters HTML normalisation introduces.
 *
 * Outlook rewrites runs of spaces as `&nbsp;`, which decodes to U+00A0. That is
 * not legal JSON whitespace, so an unnormalised payload fails to parse outright.
 * Inside a string it parses but silently corrupts leading indentation, which
 * matters for whitespace-significant content such as Markdown code blocks.
 */
function repairNbsp(text: string): string {
  return text.replace(/\u00A0/g, ' ');
}

function stripZeroWidth(text: string): string {
  return text.replace(/[\u200B-\u200D\uFEFF]/g, '');
}

/** Serialises a payload into the `<pre>`-fenced HTML body Outlook stores. */
export function serializeArrangeBody(value: unknown): string {
  // Not pretty-printed: indentation runs are exactly what HTML normalisation
  // rewrites as `&nbsp;`, and nothing reads this by eye.
  const json = JSON.stringify(value);
  const fenced = json
    .split(MARKER_PREFIX)
    .join(ESCAPED_MARKER_PREFIX)
    .replace(NORMALIZATION_SENSITIVE_REGEX, escapeAsJsonUnicode)
    // Space runs inside the user's own content are what Outlook rewrites as
    // `&nbsp;`. Escaping them leaves the serialised text with nothing to
    // rewrite, so a payload written by this version is never damaged and a
    // reader never has to guess whether a space run was ours or Outlook's.
    .replace(/ {2,}/g, run => escapeAsJsonUnicode(' ').repeat(run.length));
  return `<pre>${ARRANGE_DATA_START_MARKER}\n${escapeHtml(fenced)}\n${ARRANGE_DATA_END_MARKER}</pre>`;
}

function escapeAsJsonUnicode(ch: string): string {
  return `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;
}

/**
 * Reads the payload out of an event body that has already been reduced to
 * plain text (entities decoded, tags stripped).
 */
export function parseArrangeBody<T>(text: string): ArrangePayloadResult<T> {
  const startIndex = text.indexOf(ARRANGE_DATA_START_MARKER);
  if (startIndex === -1) {
    // A closing marker on its own means a payload was written and its opening
    // marker was damaged. Reporting "absent" would let a write replace it.
    return text.includes(ARRANGE_DATA_END_MARKER)
      ? { status: 'corrupt', reason: 'opening marker is missing' }
      : { status: 'absent' };
  }

  const payloadStart = startIndex + ARRANGE_DATA_START_MARKER.length;

  // `lastIndexOf`, not `indexOf`: content that merely mentions the end marker
  // would otherwise truncate the payload and look like corruption.
  const endIndex = text.lastIndexOf(ARRANGE_DATA_END_MARKER);
  if (endIndex === -1 || endIndex < payloadStart) {
    return { status: 'corrupt', reason: 'closing marker is missing' };
  }

  // Repair is a fallback, not a first step: a payload that already parses is
  // returned byte-for-byte, so neither a nonbreaking space nor a zero-width
  // joiner the user actually typed is rewritten. Payloads written by this
  // version escape both, so anything repaired here came from Outlook.
  const raw = text.slice(payloadStart, endIndex).trim();
  if (!raw) return { status: 'corrupt', reason: 'payload is empty' };

  const parsed =
    tryParse<T>(raw)
    ?? tryParse<T>(repairNbsp(raw))
    ?? tryParse<T>(stripZeroWidth(repairNbsp(raw)));
  if (!parsed) {
    return { status: 'corrupt', reason: describeJsonError(raw) };
  }
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
    return { status: 'corrupt', reason: 'payload is not an object' };
  }
  return { status: 'ok', data: parsed.value };
}

function tryParse<T>(json: string): { value: T } | null {
  try {
    return { value: JSON.parse(json) as T };
  } catch {
    return null;
  }
}

function describeJsonError(json: string): string {
  try {
    JSON.parse(json);
    return 'payload is not valid JSON';
  } catch (error) {
    return error instanceof Error ? error.message : 'payload is not valid JSON';
  }
}
