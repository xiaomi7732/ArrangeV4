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
  // A code span renders literally, so its contents must survive the marker
  // stripping below: `` `__init__` `` and `` `~/src` `` are text, not syntax.
  // They are lifted out first and put back once the stripping is done.
  const codeSpans: string[] = [];
  const liftCode = (code: string): string => {
    codeSpans.push(code);
    return `${CODE_SPAN_SENTINEL}${codeSpans.length - 1}${CODE_SPAN_SENTINEL}`;
  };

  const replaceLinks = (text: string): string => flattenLinks(text, liftCode);

  const withCodeLifted = source
    // Any stray sentinel in the source would collide with the placeholders.
    .split(CODE_SPAN_SENTINEL)
    .join('')
    // Fenced code: keep the contents literal — they are lifted out with the
    // code spans. The closing fence must be at least as long as the opening
    // one and on its own line, so a fence inside a code line cannot end the
    // block early and a four-backtick fence can quote a three-backtick one.
    .replace(
      /^[ \t]{0,3}(`{3,}|~{3,})[^\n]*\n([\s\S]*?)(?:\n[ \t]{0,3}\1`*~*[ \t]*(?=\n|$)|(?![\s\S]))/gm,
      (_match, _fence: string, code: string) => ` ${liftCode(code)} `,
    )
    // Any fence left over is unmatched; drop it and its language tag.
    .replace(/^[ \t]{0,3}(?:`{3,}|~{3,})[^\n]*\n?/gm, ' ')
    .replace(/(`+)([\s\S]*?)\1(?!`)/g, (_match, _fence: string, code: string) => liftCode(code));

  // Images and links keep their visible text, and their destination is kept
  // too: before remarks were Markdown they were indexed verbatim, so a search
  // for a hostname used to find the task and still should. The destination is
  // lifted out like code, because a URL is literal text — `Foo_(bar)` and
  // `__init__.py` must survive the marker stripping below — and it is
  // separated by spaces so it cannot form a match that spans the boundary
  // with the surrounding text.
  return replaceLinks(withCodeLifted)
    // Autolinks and the bare URLs remark-gfm turns into links. The URL is the
    // visible text here, so it is lifted like a destination: otherwise
    // `__init__.py` would be indexed as `init.py` and could never be found by
    // the words the reader can see on screen. A placeholder standing in for
    // code is excluded, so a URL that abuts a code span cannot swallow it.
    .replace(/<((?:https?|mailto):[^>\s\u0000]+)>/gi, (_match, url: string) => liftCode(url))
    .replace(/\b(?:https?:\/\/|mailto:)[^\s<>\u0000]+/gi, (url: string) => {
      // Trailing punctuation reads as the end of the sentence, not the URL.
      const trimmed = url.replace(/[.,;:!?'"]+$/, '');
      return liftCode(trimmed) + url.slice(trimmed.length);
    })
    // Leading block markers: headings, quotes, list bullets. A GFM task
    // marker renders as a checkbox rather than as text, so it goes with the
    // bullet that makes it one — a line of prose starting `[x]` keeps it.
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^[ \t]*(?:[-*+]|\d+\.)[ \t]+(?:\[[ xX]\][ \t]+)?/gm, '')
    // Table pipes.
    .replace(/\|/g, ' ')
    // Asterisk, tilde and backtick runs are always markers: CommonMark treats
    // them as emphasis even inside a word, so `a**b**c` really does render as
    // `abc`.
    .replace(/[*~`]+/g, '')
    // Underscores are the exception — CommonMark does not emphasise inside a
    // word, which is exactly why `snake_case` reads literally. Neighbours are
    // inspected by offset rather than captured, so adjacent runs in `x_y_z`
    // cannot consume each other's context. Unicode-aware, so `café_bar`
    // behaves like an ASCII identifier.
    .replace(/_+/g, (run, offset: number, full: string) =>
      (isWordChar(full[offset - 1]) && isWordChar(full[offset + run.length]) ? run : ''))
    .replace(
      new RegExp(`${CODE_SPAN_SENTINEL}(\\d+)${CODE_SPAN_SENTINEL}`, 'g'),
      (_match, index: string) => codeSpans[Number(index)] ?? '',
    )
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * Fences the placeholders that stand in for literal code while the Markdown
 * markers are stripped. Any occurrence in the source is removed first, so a
 * placeholder can never collide with the user's own text.
 */
const CODE_SPAN_SENTINEL = '\u0000';

/**
 * The longest link label and destination worth scanning.
 *
 * An unmatched `[` or `(` has to be abandoned at some point, and without a
 * bound every one of them would rescan the rest of the remark: a shared
 * Sheets cell full of `[x](` fragments would then take seconds to index on
 * every keystroke. Real labels and URLs are far below these.
 */
const MAX_LABEL_LENGTH = 1024;
const MAX_DESTINATION_LENGTH = 2048;

interface Destination {
  value: string;
  end: number;
}

/**
 * Reads the `(destination "title")` that follows a link label, starting at the
 * opening parenthesis. Handles the bare form with balanced parentheses, the
 * angle-bracketed form, and an optional title. Returns null when the
 * parenthesis is not closed within the bound, which means it was not a link.
 */
function readDestination(text: string, start: number): Destination | null {
  const limit = Math.min(text.length, start + MAX_DESTINATION_LENGTH);
  let i = start + 1;
  while (i < limit && (text[i] === ' ' || text[i] === '\t')) i += 1;

  let value: string;
  if (text[i] === '<') {
    const close = text.indexOf('>', i + 1);
    const newline = text.indexOf('\n', i + 1);
    if (close === -1 || close >= limit || (newline !== -1 && newline < close)) return null;
    value = text.slice(i + 1, close);
    i = close + 1;
  } else {
    const valueStart = i;
    let depth = 0;
    while (i < limit) {
      const char = text[i];
      if (char === '\\') { i += 2; continue; }
      if (char === ' ' || char === '\t' || char === '\n') break;
      if (char === '(') depth += 1;
      else if (char === ')') {
        if (depth === 0) break;
        depth -= 1;
      }
      i += 1;
    }
    if (depth !== 0) return null;
    value = text.slice(valueStart, Math.min(i, limit));
  }

  // A title may follow, in quotes or parentheses; it is not shown in the
  // rendered link. Anything else before the closing parenthesis means this was
  // never a link — `[x](foo bar baz)` renders as the literal text it looks
  // like, so its words have to stay in the index. A title may be escaped and
  // may wrap onto the next line, but not across a blank one, which ends the
  // paragraph and with it any chance that this was a link.
  while (i < limit && (text[i] === ' ' || text[i] === '\t')) i += 1;
  if (i < limit && text[i] !== ')') {
    const closer = TITLE_DELIMITERS.get(text[i]);
    if (closer === undefined) return null;
    i += 1;
    while (i < limit && text[i] !== closer) {
      if (text[i] === '\\') { i += 2; continue; }
      if (text[i] === '\n' && text[i + 1] === '\n') return null;
      i += 1;
    }
    if (text[i] !== closer) return null;
    i += 1;
    while (i < limit && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n')) i += 1;
  }
  return i < limit && text[i] === ')' ? { value, end: i + 1 } : null;
}

/** The ways a link title can be wrapped, and what closes each of them. */
const TITLE_DELIMITERS = new Map([['"', '"'], ["'", "'"], ['(', ')']]);

/**
 * Whether the character at `index` is escaped, so `\!` is a literal bang and
 * not image syntax. A backslash run only ever precedes one such character, so
 * counting it keeps the whole scan linear.
 */
function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

/**
 * Replaces every link and image with its visible text followed by its
 * destination, lifting the destination out of reach of the marker stripping.
 *
 * Hand-written rather than a regex: a destination may contain balanced
 * parentheses to any depth, and a regex that tries also backtracks badly over
 * malformed input.
 */
function flattenLinks(text: string, liftCode: (code: string) => string): string {
  // Chunks rather than one growing string: an image drops the bang before it,
  // and rewriting the whole output to do that would cost O(n^2) in the number
  // of images in one remark.
  const out: string[] = [];
  let i = 0;

  while (i < text.length) {
    if (text[i] === '\\') {
      out.push(text.slice(i, i + 2));
      i += 2;
      continue;
    }
    if (text[i] !== '[') {
      out.push(text[i]);
      i += 1;
      continue;
    }

    // A label may itself contain a link or an image, so brackets are counted.
    const labelStart = i + 1;
    const labelLimit = Math.min(text.length, labelStart + MAX_LABEL_LENGTH);
    let depth = 1;
    let j = labelStart;
    while (j < labelLimit && depth > 0) {
      const char = text[j];
      if (char === '\\') { j += 2; continue; }
      if (char === '[') depth += 1;
      else if (char === ']') depth -= 1;
      j += 1;
    }

    const destination = depth === 0 && text[j] === '('
      ? readDestination(text, j)
      : null;
    if (!destination) {
      out.push(text[i]);
      i += 1;
      continue;
    }

    // `![alt](src)` is an image: the bang is syntax, not text. An escaped
    // `\!` is a bang the reader sees, so it stays.
    if (text[i - 1] === '!' && !isEscaped(text, i - 1)) out.pop();
    const label = flattenLinks(text.slice(labelStart, j - 1), liftCode);
    out.push(`${label} ${liftCode(destination.value)} `);
    i = destination.end;
  }

  return out.join('');
}

const WORD_CHAR_REGEX = /[\p{L}\p{N}_]/u;

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && WORD_CHAR_REGEX.test(char);
}
