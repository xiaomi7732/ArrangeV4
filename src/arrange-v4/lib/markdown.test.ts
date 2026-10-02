import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { markdownToSearchText, safeMarkdownUrl } from './markdown';

describe('safeMarkdownUrl', () => {
  it('allows the protocols a note legitimately links to', () => {
    assert.equal(safeMarkdownUrl('https://example.com/a'), 'https://example.com/a');
    assert.equal(safeMarkdownUrl('http://example.com'), 'http://example.com');
    assert.equal(safeMarkdownUrl('mailto:someone@example.com'), 'mailto:someone@example.com');
  });

  it('rejects script-bearing and payload-bearing URLs', () => {
    assert.equal(safeMarkdownUrl('javascript:alert(1)'), null);
    assert.equal(safeMarkdownUrl('  javascript:alert(1)  '), null);
    assert.equal(safeMarkdownUrl('JavaScript:alert(1)'), null);
    assert.equal(safeMarkdownUrl('data:text/html;base64,PHNjcmlwdD4='), null);
    assert.equal(safeMarkdownUrl('vbscript:msgbox(1)'), null);
    assert.equal(safeMarkdownUrl('file:///C:/Windows/System32'), null);
  });

  it('rejects anything that is not an absolute URL', () => {
    assert.equal(safeMarkdownUrl('/books'), null);
    assert.equal(safeMarkdownUrl('#section'), null);
    assert.equal(safeMarkdownUrl('example.com'), null);
    assert.equal(safeMarkdownUrl(''), null);
    assert.equal(safeMarkdownUrl('   '), null);
    assert.equal(safeMarkdownUrl(null), null);
    assert.equal(safeMarkdownUrl(undefined), null);
  });

  it('trims surrounding whitespace from an accepted URL', () => {
    assert.equal(safeMarkdownUrl('  https://example.com  '), 'https://example.com');
  });
});

describe('markdownToSearchText', () => {
  it('keeps link labels and their targets', () => {
    // Before remarks were Markdown they were indexed verbatim, so searching
    // for a hostname found the task; that recall is preserved.
    assert.equal(
      markdownToSearchText('see [the design doc](https://example.com/spec) first'),
      'see the design doc https://example.com/spec first',
    );
  });

  it('keeps image alt text and the image URL', () => {
    assert.equal(
      markdownToSearchText('![burndown chart](https://x/y.png)'),
      'burndown chart https://x/y.png',
    );
  });

  it('indexes a URL literally, so its punctuation survives', () => {
    // A URL is not Markdown: stripping its underscores or asterisks would
    // index something the user can never search for.
    assert.equal(
      markdownToSearchText('[wiki](https://en.wikipedia.org/wiki/Foo_(bar))'),
      'wiki https://en.wikipedia.org/wiki/Foo_(bar)',
    );
    assert.equal(
      markdownToSearchText('[src](https://host/__init__.py)'),
      'src https://host/__init__.py',
    );
    assert.equal(
      markdownToSearchText('[deep](https://x/a(b(c))d)'),
      'deep https://x/a(b(c))d',
    );
  });

  it('keeps the words around an unclosed link, which are plainly visible', () => {
    assert.equal(
      markdownToSearchText('see [step 2](no link here\nping ops (they have the pager)'),
      'see [step 2](no link here\nping ops (they have the pager)',
    );
  });

  it('flattens a long run of malformed links without stalling', () => {
    const started = Date.now();
    markdownToSearchText('[x]('.repeat(12_000));
    markdownToSearchText(`[a](${'x'.repeat(48_000)}`);
    assert.ok(Date.now() - started < 1_000, 'flattening should stay close to linear');
  });

  it('keeps an image nested inside a link', () => {
    assert.equal(
      markdownToSearchText('[![chart](https://x/y.png)](https://x/report)'),
      'chart https://x/y.png https://x/report',
    );
  });

  it('keeps the words of something that only looks like a link', () => {
    // `[x](foo bar baz)` has no valid title, so it renders as plain text.
    assert.equal(markdownToSearchText('[x](foo bar baz)'), '[x](foo bar baz)');
    assert.equal(markdownToSearchText('[x](https://h "a title")'), 'x https://h');
    assert.equal(markdownToSearchText('[x](https://h (a title))'), 'x https://h');
  });

  it('keeps an escaped bang, which the reader sees', () => {
    assert.equal(
      markdownToSearchText('\\![x](https://host)'),
      '\\!x https://host',
    );
  });

  it('unwraps an angle-bracketed destination and drops a link title', () => {
    assert.equal(
      markdownToSearchText('[a](<https://example.com/a b>)'),
      'a https://example.com/a b',
    );
    assert.equal(
      markdownToSearchText('[a](https://example.com "the title")'),
      'a https://example.com',
    );
  });

  it('drops task list checkboxes, which render as boxes rather than text', () => {
    // Otherwise a search for "x" matches every remark with a ticked box.
    assert.equal(
      markdownToSearchText('- [x] ship it\n- [ ] write it up'),
      'ship it\nwrite it up',
    );
    // Without a bullet it is not a task item, just prose starting with "[x]".
    assert.equal(markdownToSearchText('[x] marks the spot'), '[x] marks the spot');
  });

  it('keeps autolink targets, which are the only text shown', () => {
    assert.equal(
      markdownToSearchText('ping <https://example.com/status>'),
      'ping https://example.com/status',
    );
  });

  it('indexes a visible URL literally, bracketed or not', () => {
    // The URL is the text the reader sees, so it has to be searchable as
    // written rather than stripped of its Markdown-looking punctuation.
    assert.equal(
      markdownToSearchText('<https://host/__init__.py>'),
      'https://host/__init__.py',
    );
    assert.equal(
      markdownToSearchText('see https://host/a*b*c and https://x/Foo_(bar) here'),
      'see https://host/a*b*c and https://x/Foo_(bar) here',
    );
    assert.equal(
      markdownToSearchText('read https://host/page.'),
      'read https://host/page.',
    );
    assert.equal(
      markdownToSearchText('HTTPS://host/__init__.py'),
      'HTTPS://host/__init__.py',
    );
  });

  it('keeps code that abuts a URL, which has no space to separate it', () => {
    assert.equal(
      markdownToSearchText('see https://host/path`__init__`'),
      'see https://host/path__init__',
    );
    // A code span binds tighter than an autolink, so the brackets stay as the
    // literal text they render as — what matters is that `b` is still indexed.
    assert.equal(
      markdownToSearchText('<https://host/a`b`>'),
      '<https://host/ab>',
    );
  });

  it('flattens a remark full of images without stalling', () => {
    const started = Date.now();
    markdownToSearchText('![a](b) '.repeat(40_000));
    assert.ok(Date.now() - started < 1_000, 'image flattening should stay close to linear');
  });

  it('accepts a link title that is escaped or wraps onto the next line', () => {
    assert.equal(
      markdownToSearchText('[doc](https://host/a "say \\"old\\" version")'),
      'doc https://host/a',
    );
    assert.equal(
      markdownToSearchText('[doc](https://host/a "a title\nover two lines")'),
      'doc https://host/a',
    );
    // A blank line ends the paragraph, so this was never a link.
    assert.equal(
      markdownToSearchText('[doc](https://host/a "unclosed\n\nlater words")').includes('later words'),
      true,
    );
  });

  it('strips heading, quote and list markers', () => {
    assert.equal(markdownToSearchText('## Plan'), 'Plan');
    assert.equal(markdownToSearchText('> quoted note'), 'quoted note');
    assert.equal(markdownToSearchText('- first\n* second\n1. third'), 'first\nsecond\nthird');
  });

  it('strips emphasis, strikethrough and code markers but keeps the words', () => {
    assert.equal(markdownToSearchText('**bold** _italic_ ~~gone~~ `code`'), 'bold italic gone code');
  });

  it('keeps markers that are part of a word, so identifiers stay searchable', () => {
    // Stripping them everywhere indexed `snake_case` as `snakecase`, which a
    // user searching for the term they typed would never match.
    assert.equal(markdownToSearchText('rename snake_case to camelCase'), 'rename snake_case to camelCase');
    assert.equal(markdownToSearchText('use `snake_case` here'), 'use snake_case here');
    assert.equal(markdownToSearchText('**fix snake_case**'), 'fix snake_case');
  });

  it('applies the word rule to non-ASCII words too', () => {
    assert.equal(markdownToSearchText('fix café_bar handling'), 'fix café_bar handling');
    assert.equal(markdownToSearchText('**日本語** notes'), '日本語 notes');
  });

  it('leaves an intra-word underscore run alone but not an asterisk run', () => {
    // CommonMark emphasises `*` inside a word but not `_`, so the flattened
    // text matches what the reader actually sees in both cases.
    assert.equal(markdownToSearchText('x_y_z'), 'x_y_z');
    assert.equal(markdownToSearchText('foo**bar**baz'), 'foobarbaz');
    assert.equal(markdownToSearchText('a**b**c'), 'abc');
  });

  it('indexes a code span literally', () => {
    // Markdown inside a code span is text, not syntax: react-markdown renders
    // `__init__` and `~/src` as typed, so searching for them must match.
    assert.equal(markdownToSearchText('see `__init__` first'), 'see __init__ first');
    assert.equal(markdownToSearchText('cd `~/src`'), 'cd ~/src');
    assert.equal(markdownToSearchText('`a_b` and `c_d`'), 'a_b and c_d');
    assert.equal(markdownToSearchText('**bold** then `*literal*`'), 'bold then *literal*');
  });

  it('indexes fenced code literally and respects the fence length', () => {
    const quoted = '````\nuse ```js in a remark\n````';
    assert.equal(markdownToSearchText(quoted), 'use ```js in a remark');
    const inner = '```\nconsole.log("```")\n```';
    assert.equal(markdownToSearchText(inner), 'console.log("```")');
    assert.equal(markdownToSearchText('```py\n__init__ = 1\n```'), '__init__ = 1');
    // The closing fence, not the first line end, terminates the block.
    assert.equal(
      markdownToSearchText('```py\nfirst = 1\n__init__ = 2\n```'),
      'first = 1\n__init__ = 2',
    );
    assert.equal(markdownToSearchText('```py\nfirst = 1\n__init__ = 2'), 'first = 1\n__init__ = 2');
  });

  it('keeps the contents of a fenced code block', () => {
    const text = markdownToSearchText('```ts\nconst answer = 42;\n```');
    assert.ok(text.includes('const answer = 42;'), text);
    assert.ok(!text.includes('```'), text);
  });

  it('keeps table cell text', () => {
    assert.equal(markdownToSearchText('| name | owner |'), 'name owner');
  });

  it('leaves plain prose untouched apart from trimming', () => {
    assert.equal(markdownToSearchText('  just a normal note  '), 'just a normal note');
  });
});
