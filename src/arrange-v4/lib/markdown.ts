/**
 * Markdown helpers that must stay pure so they can be tested directly.
 *
 * Note: this module is compiled by tsconfig.test.json, which does not rewrite
 * the "@/" path alias, so imports here must stay relative.
 */

/**
 * Protocols a remark is allowed to link to.
 *
 * Remarks are not guaranteed to be self-authored — a Sheets book can be shared
 * with edit access and the cell can be changed outside the app — so anything
 * that could execute (`javascript:`) or smuggle a payload (`data:`) is dropped.
 */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * Returns the URL to use for a link, or null when it must not be clickable.
 *
 * Relative and anchor URLs are rejected rather than resolved: a remark has no
 * meaningful base inside the app, so they can only point somewhere surprising.
 */
export function safeMarkdownUrl(url: string | null | undefined): string | null {
  if (!url) return null;

  const trimmed = url.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  return ALLOWED_PROTOCOLS.has(parsed.protocol) ? trimmed : null;
}

/**
 * Flattens Markdown source to the words a reader would see, so searching for a
 * word does not depend on whether it happens to sit inside link or emphasis
 * syntax. Deliberately approximate: it only has to feed the search index.
 */
export function markdownToSearchText(source: string): string {
  return source
    // Fenced code: keep the code, drop the fences and any language tag.
    .replace(/```[^\n]*\n?/g, ' ')
    .replace(/~~~[^\n]*\n?/g, ' ')
    // Images first, so their alt text survives but the URL does not.
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Inline links: keep the label, drop the target.
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Autolinks.
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, '$1')
    // Leading block markers: headings, quotes, list bullets.
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^[ \t]*(?:[-*+]|\d+\.)[ \t]+/gm, '')
    // Table pipes.
    .replace(/\|/g, ' ')
    // Emphasis, strikethrough and inline code markers, but only when the run is
    // not inside a word: stripping them everywhere turned `snake_case` into
    // `snakecase`, which no one would ever search for. Unicode-aware, so
    // `café_bar` is treated the same way as an ASCII identifier. Written with a
    // replacer rather than lookbehind, which older Safari cannot even parse.
    .replace(/([\p{L}\p{N}_]?)([*_~`]+)([\p{L}\p{N}_]?)/gu, (match, before, _run, after) =>
      (before && after ? match : `${before}${after}`))
    .replace(/[ \t]+/g, ' ')
    .trim();
}
